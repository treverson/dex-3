import { ContractWrappers } from '0x.js'
import log from '../utils/log'
import WebsocketProviderWrapper from './WebsocketProviderWrapper'
import { IEventFilters } from '../types'
import { Order, MethodOpts, OrderInfo } from '@0x/contract-wrappers'
const Web3 = require('web3')

class OrderBlockchainService {
  httpContractWrappers: ContractWrappers
  httpContract: any
  httpProvider: any
  websocketProviderWrapper: WebsocketProviderWrapper
  networkId: number
  contractAddresses: any

  constructor ({ networkId, contractAddresses, websocketProviderWrapper, httpProvider }) {
    this.httpProvider = httpProvider
    this.networkId = networkId
    this.contractAddresses = contractAddresses

    /** HTTP transport */
    this.httpContractWrappers = this.getExchangeContractWrappers(this.httpProvider)
    this.httpContract = this.getExchangeContract(this.httpProvider, this.httpContractWrappers)

    /** websocket transport */
    this.websocketProviderWrapper = websocketProviderWrapper
  }

  getExchangeWsContract () {
    const provider = this.websocketProviderWrapper.getProvider()
    const contractWrappers = this.getExchangeContractWrappers(provider)
    return this.getExchangeContract(provider, contractWrappers)
  }

  getExchangeContractWrappers (provider) {
    return new ContractWrappers(
      provider,
      {
        networkId: this.networkId,
        contractAddresses: this.contractAddresses
      }
    )
  }

  getExchangeContract (provider, contractWrappers) {
    const web3 = new Web3(provider)
    const contract = new web3.eth.Contract(
      contractWrappers.exchange.abi,
      contractWrappers.exchange.address
    )

    return contract
  }

  /**
   * Load order history from blockchain.
   * We load info about past fill events filtered by orderHash so result may contain
   */
  loadOrderHistory (orderHash: string, { fromBlock = 0 } = {}) {
    return this.getPastEvents(
      'Fill',
      {
        fromBlock,
        filter: {
          orderHash
        }
      }
    )
  }

  getPastEvents (event, filters: IEventFilters = { fromBlock: 0, toBlock: 'latest', filter: {} }) {
    return this.httpContract.getPastEvents(
      event,
      filters
    )
  }

  subscribe (event, onData: Function, onError: Function) {
    let subscription
    this.websocketProviderWrapper.onConnect(() => {
      log.info('subscribing to event: ', event)
      const wsContract = this.getExchangeWsContract()
      if (subscription) {
        subscription.unsubscribe()
        log.info('unsubscribed from previous subscription on event: ', event)
      }
      subscription = this.subscribeOnContract(wsContract, event, onData, onError)
      log.info('subscribed to event: ', event)
    })
  }

  subscribeOnContract (wsContract, event, onData: Function, onError: Function) {
    return wsContract.events[event]()
      .on('data', onData)
      .on('error', onError)
  }

  getOrderInfoAsync (order: Order, opts: MethodOpts = {}): Promise<OrderInfo> {
    return this.httpContractWrappers.exchange.getOrderInfoAsync(order, opts)
  }
}

export default OrderBlockchainService
