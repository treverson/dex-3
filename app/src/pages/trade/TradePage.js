import React from 'react'
import jss from 'react-jss'
import Layout from 'components/Layout'
import Wallet from './components/Wallet'
import Marketplace from './components/Marketplace'
import Orderbook from './components/Orderbook'

const decorate = jss({
  root: {
    display: 'flex',
    flexDirection: 'column'
  }
})

const TradePage = ({classes}) =>
  <Layout contentClassName={classes.root}>
    <Wallet />
    <Marketplace />
    <Orderbook />
  </Layout>

export default decorate(TradePage)
