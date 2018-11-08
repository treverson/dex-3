import axios from 'axios'
import * as R from 'ramda'
import {
  generateBid,
  getTokenBalance,
  getEthBalance,
  awaitTransaction,
  setUnlimitedTokenAllowanceAsync,
  getTokenAllowance,
  setZeroTokenAllowanceAsync,
  delay,
  makeLimitOrderAsync,
  makeMarketOrderAsync,
  sendUnwrapWethTx,
  sendWrapWethTx
} from '../helpers'
import { getToken } from 'selectors'
import { assetDataUtils } from '@0x/order-utils'

const uuidv4 = require('uuid/v4')

const SET_BIDS = 'SET_BIDS'
const SET_ASKS = 'SET_ASKS'
const SET_MARKETPLACE_TOKEN = 'SET_MARKETPLACE_TOKEN'
const SET_CURRENT_TOKEN = 'SET_CURRENT_TOKEN'
const SET_ACCOUNT = 'SET_ACCOUNT'
const SET_NETWORK = 'SET_NETWORK'
const SET_TOKEN_BALANCE = 'SET_TOKEN_BALANCE'
const SET_ETH_BALANCE = 'SET_ETH_BALANCE'
const SET_TOKENS = 'SET_TOKENS'
const SET_TOKEN_ALLOWANCE = 'SET_TOKEN_ALLOWANCE'
const SET_ACCOUNT_ORDERS = 'SET_ACCOUNT_ORDERS'

const initialState = {
  bids: [],
  asks: [],
  marketplaceToken: {},
  currentToken: {},
  account: '',
  accountOrders: [],
  network: '',
  ethBalance: 0,
  tokenBalances: {},
  tokenAllowances: {},
  tokens: []
}

export default (state = initialState, { type, payload }) => {
  switch (type) {
    case SET_BIDS:
      return { ...state, bids: payload }
    case SET_ASKS:
      return { ...state, asks: payload }
    case SET_MARKETPLACE_TOKEN:
      return { ...state, marketplaceToken: payload }
    case SET_CURRENT_TOKEN:
      return { ...state, currentToken: payload }
    case SET_ACCOUNT:
      return { ...state, account: payload }
    case SET_NETWORK:
      return { ...state, network: payload }
    case SET_ETH_BALANCE:
      return { ...state, ethBalance: payload }
    case SET_TOKEN_BALANCE:
      return {
        ...state,
        tokenBalances: {
          ...state.tokenBalances,
          [payload.symbol]: payload.value
        }
      }
    case SET_TOKEN_ALLOWANCE:
      return {
        ...state,
        tokenAllowances: {
          ...state.tokenAllowances,
          [payload.symbol]: payload.value
        }
      }
    case SET_TOKENS:
      return { ...state, tokens: payload }
    case SET_ACCOUNT_ORDERS:
      return { ...state, accountOrders: payload }
    default:
      return state
  }
}

const setBids = payload => ({ type: SET_BIDS, payload })
const setAsks = payload => ({ type: SET_ASKS, payload })
const setMarketplaceToken = payload => ({ type: SET_MARKETPLACE_TOKEN, payload })
const setCurrentToken = payload => ({ type: SET_CURRENT_TOKEN, payload })
const setTokens = payload => ({ type: SET_TOKENS, payload })
export const setAccount = payload => ({ type: SET_ACCOUNT, payload })
export const setNetwork = payload => ({ type: SET_NETWORK, payload })
const setTokenBalance = (symbol, value) => ({ type: SET_TOKEN_BALANCE, payload: { symbol, value } })
const setEthBalance = payload => ({ type: SET_ETH_BALANCE, payload })
const setTokenAllowance = (symbol, value) => ({ type: SET_TOKEN_ALLOWANCE, payload: { symbol, value } })
const setAccountOrders = payload => ({ type: SET_ACCOUNT_ORDERS, payload })

export const loadEthBalance = web3 => async (dispatch, getState) => {
  const { account } = getState()
  const balance = await getEthBalance(web3, account)

  dispatch(setEthBalance(balance))
}

export const loadTokenAllowance = (web3, token) => async (dispatch, getState) => {
  const { account } = getState()

  const result = await getTokenAllowance(web3, account, token.address)

  dispatch(setTokenAllowance(token.symbol, !result.isZero()))
}

export const setUnlimitedTokenAllowance = (web3, token) => async (dispatch, getState) => {
  const { account } = getState()

  await setUnlimitedTokenAllowanceAsync(web3, account, token.address)

  await dispatch(loadTokenAllowance(web3, token))
}

export const setZeroTokenAllowance = (web3, token) => async (dispatch, getState) => {
  const { account } = getState()

  await setZeroTokenAllowanceAsync(web3, account, token.address)

  await dispatch(loadTokenAllowance(web3, token))
}

export const resetHighlighting = () => async (dispatch, getState) => {
  await new Promise(resolve => setTimeout(resolve, 2000))

  const { bids, asks } = getState()

  dispatch(setBids(bids.map(R.dissoc('highlight'))))
  dispatch(setAsks(asks.map(R.dissoc('highlight'))))
}

const sortBids = R.sort(
  R.descend(
    R.path([
      'data',
      'price'
    ])
  )
)

export const setOrderbook = ({ bids, asks }) => (dispatch, getState) => {
  const { marketplaceToken, currentToken } = getState()

  const formattedBids = bids.records.map(
    order => generateBid({
      order: order.order,
      baseToken: marketplaceToken,
      quoteToken: currentToken
    })
  )

  const bidsSorted = sortBids(formattedBids)
  dispatch(setBids(bidsSorted))

  const formattedAsks = asks.records.map(
    order => generateBid({
      order: order.order,
      baseToken: marketplaceToken,
      quoteToken: currentToken
    })
  )

  const asksSorted = sortBids(formattedAsks)
  dispatch(setAsks(asksSorted))
}

export const addOrders = orders => (dispatch, getState) => {
  const { marketplaceToken, currentToken, bids, asks } = getState()

  // order is in SRA2 format { order: {}, metaData: {} }
  const expandedOrders = orders.map(order => ({
    ...generateBid({
      order: order.order,
      baseToken: marketplaceToken,
      quoteToken: currentToken
    }),
    highlight: true
  }))

  const isBid = ({ order }) => order.makerAssetAddress === currentToken.address &&
    order.takerAssetAddress === marketplaceToken.address

  const newBids = expandedOrders.filter(isBid)
  const newAsks = expandedOrders.filter(R.complement(isBid))

  if (newBids.length > 0) {
    const sortedBids = sortBids([...bids, ...newBids])

    dispatch(setBids(sortedBids))
  }

  if (newAsks.length > 0) {
    const sortedAsks = sortBids([...asks, ...newAsks])

    dispatch(setAsks(sortedAsks))
  }

  dispatch(resetHighlighting())
}

export const loadOrderbook = socket => async (dispatch, getState) => {
  const { marketplaceToken, currentToken } = getState()

  socket.send(JSON.stringify({
    type: 'unsubscribe',
    channel: 'orders'
  }))

  socket.send(JSON.stringify({
    type: 'subscribe',
    channel: 'orders',
    requestId: uuidv4(),
    payload: {
      makerAssetAddress: marketplaceToken.address,
      takerAssetAddress: currentToken.address
    }
  }))

  socket.send(JSON.stringify({
    type: 'subscribe',
    channel: 'orders',
    requestId: uuidv4(),
    payload: {
      makerAssetAddress: currentToken.address,
      takerAssetAddress: marketplaceToken.address
    }
  }))

  // TODO play with ERC721 tokens in future
  const baseAssetData = assetDataUtils.encodeERC20AssetData(currentToken.address)
  const quoteAssetData = assetDataUtils.encodeERC20AssetData(marketplaceToken.address)
  const { data } = await axios(
    '/api/relayer/v0/orderbook',
    {
      params: {
        baseAssetData,
        quoteAssetData
      }
    }
  )

  dispatch(setOrderbook(data))
}

export const loadMarketplaceToken = symbol => async dispatch => {
  const { data } = await axios(`/api/v1/tokens/${symbol}`)
  dispatch(setMarketplaceToken(data))
}

export const loadCurrentToken = symbol => async dispatch => {
  const { data } = await axios(`/api/v1/tokens/${symbol}`)
  dispatch(setCurrentToken(data))
}

export const loadTokens = tokens => async dispatch => {
  const { data } = await axios.get('/api/v1/tokens')
  dispatch(setTokens(data))
}

export const loadTokenBalance = (web3, token) => async (dispatch, getState) => {
  const { account } = getState()
  const balance = await getTokenBalance(web3, account, token.address)

  dispatch(setTokenBalance(token.symbol, balance))
}

export const makeLimitOrder = (web3, { type, amount, price }) => async (dispatch, getState) => {
  const { marketplaceToken, currentToken, account } = getState()

  let data

  if (type === 'buy') {
    data = {
      takerToken: currentToken,
      takerAmount: amount,
      makerToken: marketplaceToken,
      makerAmount: price.times(amount)
    }
  } else {
    data = {
      takerToken: marketplaceToken,
      takerAmount: price.times(amount),
      makerToken: currentToken,
      makerAmount: amount
    }
  }

  const signedOrder = await makeLimitOrderAsync(web3, account, data)

  await axios.post('/api/relayer/v0/order', signedOrder)
}

export const makeMarketOrder = (web3, { type, amount }) => async (dispatch, getState) => {
  const { bids, asks, account } = getState()

  const ordersToCheck = (type === 'buy' ? bids : asks).map(one => one.order)

  const fillTxHash = await makeMarketOrderAsync(web3, account, ordersToCheck, amount)

  console.log('fillTxHash: ', fillTxHash)
}

export const wrapEth = (web3, amount) => async (dispatch, getState) => {
  const wethToken = getToken('WETH', getState())
  if (!wethToken) {
    console.error('WETH token is not found')
    return
  }

  const { account } = getState()

  const txHash = await sendWrapWethTx(web3, account, wethToken, amount)

  await awaitTransaction(web3, txHash)

  await delay(2000)
  dispatch(loadTokenBalance(web3, wethToken))

  await delay(3000)
  dispatch(loadEthBalance(web3))
}

export const unwrapWeth = (web3, amount) => async (dispatch, getState) => {
  const wethToken = getToken('WETH', getState())
  if (!wethToken) {
    console.error('WETH token is not found')
    return
  }

  const { account } = getState()

  const txHash = await sendUnwrapWethTx(web3, account, wethToken, amount)

  await awaitTransaction(web3, txHash)

  await delay(2000)
  dispatch(loadTokenBalance(web3, wethToken))

  await delay(3000)
  dispatch(loadEthBalance(web3))
}

export const loadActiveAccountOrders = (address) => async dispatch => {
  const { data } = await axios.get(`/api/v1/accounts/${address}/orders`)
  dispatch(setAccountOrders(data))
}
