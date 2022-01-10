import { parseUnits } from '@ethersproject/units'
import { Currency, CurrencyAmount, ETHER, JSBI, Token, TokenAmount, Trade } from '@pancakeswap/sdk'
import { ParsedQs } from 'qs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import useENS from 'hooks/ENS/useENS'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { TX8, USDT, useCurrency } from 'hooks/Tokens'
import { useTradeExactIn, useTradeExactOut } from 'hooks/Trades'
import useParsedQueryString from 'hooks/useParsedQueryString'
import { useTranslation } from 'contexts/Localization'
import { isAddress } from 'utils'
import { computeSlippageAdjustedAmounts } from 'utils/prices'
import Web3 from 'web3'
import BN from 'bn.js'
import BigNumber from 'bignumber.js'
import { AppDispatch, AppState } from '../index'
import { useCurrencyBalances } from '../wallet/hooks'
import { Field, replaceSwapState, selectCurrency, setRecipient, switchCurrencies, typeInput } from './actions'
import { SwapState } from './reducer'
import { useUserSlippageTolerance } from '../user/hooks'
import { useTokenContract, useTx8SwapContract } from '../../hooks/useContract'
import { addresses } from '../../config/constants/tokens'
import useToast from '../../hooks/useToast'
import useWhyDidYouUpdate from '../../hooks/useWhyDidYouUpdate'

export function useSwapState(): AppState['swap'] {
  return useSelector<AppState, AppState['swap']>(state => state.swap)
}

export function useSwapActionHandlers(): {
  onCurrencySelection: (field: Field, currency: Currency) => void
  onSwitchTokens: () => void
  onUserInput: (field: Field, typedValue: string) => void
  onChangeRecipient: (recipient: string | null) => void
} {
  const dispatch = useDispatch<AppDispatch>()
  const onCurrencySelection = useCallback(
    (field: Field, currency: Currency) => {
      dispatch(
        selectCurrency({
          field,
          currencyId: currency instanceof Token ? currency.address : currency === ETHER ? 'BNB' : '',
        }),
      )
    },
    [dispatch],
  )

  const onSwitchTokens = useCallback(() => {
    dispatch(switchCurrencies())
  }, [dispatch])

  const onUserInput = useCallback(
    (field: Field, typedValue: string) => {
      dispatch(typeInput({ field, typedValue }))
    },
    [dispatch],
  )

  const onChangeRecipient = useCallback(
    (recipient: string | null) => {
      dispatch(setRecipient({ recipient }))
    },
    [dispatch],
  )

  return {
    onSwitchTokens,
    onCurrencySelection,
    onUserInput,
    onChangeRecipient,
  }
}

// try to parse a user entered amount for a given token
export function tryParseAmount(value?: string, currency?: Currency): CurrencyAmount | undefined {
  if (!value || !currency) {
    return undefined
  }
  try {
    const typedValueParsed = parseUnits(value, currency.decimals).toString()
    if (typedValueParsed !== '0') {
      return currency instanceof Token
        ? new TokenAmount(currency, JSBI.BigInt(typedValueParsed))
        : CurrencyAmount.ether(JSBI.BigInt(typedValueParsed))
    }
  } catch (error) {
    // should fail if the user specifies too many decimal places of precision (or maybe exceed max uint?)
    console.debug(`Failed to parse input amount: "${value}"`, error)
  }
  // necessary for all paths to return a value
  return undefined
}

const BAD_RECIPIENT_ADDRESSES: string[] = [
  '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // v2 factory
  '0xf164fC0Ec4E93095b804a4795bBe1e041497b92a', // v2 router 01
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // v2 router 02
]

/**
 * Returns true if any of the pairs or tokens in a trade have the given checksummed address
 * @param trade to check for the given address
 * @param checksummedAddress address to check in the pairs and tokens
 */
function involvesAddress(trade: Trade, checksummedAddress: string): boolean {
  return (
    trade.route.path.some(token => token.address === checksummedAddress) ||
    trade.route.pairs.some(pair => pair.liquidityToken.address === checksummedAddress)
  )
}

// from the current swap inputs, compute the best trade and return it.
export function useDerivedSwapInfo(): {
  currencies: { [field in Field]?: Currency }
  currencyBalances: { [field in Field]?: CurrencyAmount }
  parsedAmount: CurrencyAmount | undefined
  v2Trade: Trade | undefined
  inputError?: string
} {
  const { account } = useActiveWeb3React()
  const { t } = useTranslation()

  const {
    independentField,
    typedValue,
    [Field.INPUT]: { currencyId: inputCurrencyId },
    [Field.OUTPUT]: { currencyId: outputCurrencyId },
    recipient,
  } = useSwapState()

  const inputCurrency = useCurrency(inputCurrencyId)
  const outputCurrency = useCurrency(outputCurrencyId)
  const recipientLookup = useENS(recipient ?? undefined)
  const to: string | null = (recipient === null ? account : recipientLookup.address) ?? null

  const relevantTokenBalances = useCurrencyBalances(account ?? undefined, [
    inputCurrency ?? undefined,
    outputCurrency ?? undefined,
  ])

  const isExactIn: boolean = independentField === Field.INPUT
  const parsedAmount = tryParseAmount(typedValue, (isExactIn ? inputCurrency : outputCurrency) ?? undefined)

  const bestTradeExactIn = useTradeExactIn(isExactIn ? parsedAmount : undefined, outputCurrency ?? undefined)
  const bestTradeExactOut = useTradeExactOut(inputCurrency ?? undefined, !isExactIn ? parsedAmount : undefined)

  const v2Trade = isExactIn ? bestTradeExactIn : bestTradeExactOut

  const currencyBalances = {
    [Field.INPUT]: relevantTokenBalances[0],
    [Field.OUTPUT]: relevantTokenBalances[1],
  }

  const currencies: { [field in Field]?: Currency } = {
    [Field.INPUT]: inputCurrency ?? undefined,
    [Field.OUTPUT]: outputCurrency ?? undefined,
  }

  let inputError: string | undefined
  if (!account) {
    inputError = t('Connect Wallet')
  }

  if (!parsedAmount) {
    inputError = inputError ?? t('Enter an amount')
  }

  if (!currencies[Field.INPUT] || !currencies[Field.OUTPUT]) {
    inputError = inputError ?? t('Select a token')
  }

  const formattedTo = isAddress(to)
  if (!to || !formattedTo) {
    inputError = inputError ?? t('Enter a recipient')
  } else if (
    BAD_RECIPIENT_ADDRESSES.indexOf(formattedTo) !== -1 ||
    (bestTradeExactIn && involvesAddress(bestTradeExactIn, formattedTo)) ||
    (bestTradeExactOut && involvesAddress(bestTradeExactOut, formattedTo))
  ) {
    inputError = inputError ?? t('Invalid recipient')
  }

  const [allowedSlippage] = useUserSlippageTolerance()

  const slippageAdjustedAmounts = v2Trade && allowedSlippage && computeSlippageAdjustedAmounts(v2Trade, allowedSlippage)

  // compare input balance to max input based on version
  const [balanceIn, amountIn] = [
    currencyBalances[Field.INPUT],
    slippageAdjustedAmounts ? slippageAdjustedAmounts[Field.INPUT] : null,
  ]

  if (balanceIn && amountIn && balanceIn.lessThan(amountIn)) {
    inputError = t('Insufficient %symbol% balance', { symbol: amountIn.currency.symbol })
  }

  return {
    currencies,
    currencyBalances,
    parsedAmount,
    v2Trade: v2Trade ?? undefined,
    inputError,
  }
}

function parseCurrencyFromURLParameter(urlParam: any): string {
  if (typeof urlParam === 'string') {
    const valid = isAddress(urlParam)
    if (valid) return valid
    if (urlParam.toUpperCase() === 'BNB') return 'BNB'
    if (valid === false) return 'BNB'
  }
  return 'BNB' ?? ''
}

function parseTokenAmountURLParameter(urlParam: any): string {
  // eslint-disable-next-line no-restricted-globals
  return typeof urlParam === 'string' && !isNaN(parseFloat(urlParam)) ? urlParam : ''
}

function parseIndependentFieldURLParameter(urlParam: any): Field {
  return typeof urlParam === 'string' && urlParam.toLowerCase() === 'output' ? Field.OUTPUT : Field.INPUT
}

const ENS_NAME_REGEX = /^[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)?$/
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/
function validatedRecipient(recipient: any): string | null {
  if (typeof recipient !== 'string') return null
  const address = isAddress(recipient)
  if (address) return address
  if (ENS_NAME_REGEX.test(recipient)) return recipient
  if (ADDRESS_REGEX.test(recipient)) return recipient
  return null
}

export function queryParametersToSwapState(parsedQs: ParsedQs): SwapState {
  let inputCurrency = parseCurrencyFromURLParameter(parsedQs.inputCurrency)
  let outputCurrency = parseCurrencyFromURLParameter(parsedQs.outputCurrency)
  if (inputCurrency === outputCurrency) {
    if (typeof parsedQs.outputCurrency === 'string') {
      inputCurrency = ''
    } else {
      outputCurrency = ''
    }
  }

  const recipient = validatedRecipient(parsedQs.recipient)

  return {
    [Field.INPUT]: {
      currencyId: inputCurrency,
    },
    [Field.OUTPUT]: {
      currencyId: outputCurrency,
    },
    typedValue: parseTokenAmountURLParameter(parsedQs.exactAmount),
    independentField: parseIndependentFieldURLParameter(parsedQs.exactField),
    recipient,
  }
}

// updates the swap state to use the defaults for a given network
export function useDefaultsFromURLSearch():
  | { inputCurrencyId: string | undefined; outputCurrencyId: string | undefined }
  | undefined {
  const { chainId } = useActiveWeb3React()
  const dispatch = useDispatch<AppDispatch>()
  const parsedQs = useParsedQueryString()
  const [result, setResult] = useState<
    { inputCurrencyId: string | undefined; outputCurrencyId: string | undefined } | undefined
  >()

  useEffect(() => {
    if (!chainId) return
    const parsed = queryParametersToSwapState(parsedQs)

    dispatch(
      replaceSwapState({
        typedValue: parsed.typedValue,
        field: parsed.independentField,
        // inputCurrencyId: parsed[Field.INPUT].currencyId,
        // outputCurrencyId: parsed[Field.OUTPUT].currencyId,
        inputCurrencyId: addresses.tx8, // tx8
        outputCurrencyId: addresses.usdt, // usdt
        recipient: null,
      }),
    )

    setResult({ inputCurrencyId: parsed[Field.INPUT].currencyId, outputCurrencyId: parsed[Field.OUTPUT].currencyId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, chainId])

  return result
}

const USDT_TO_TX8_RATE = '200'

export const useSwapInfo = (): { inputAmount?: CurrencyAmount; outputAmount?: CurrencyAmount } => {
  const {
    independentField,
    typedValue,
    [Field.INPUT]: { currencyId: inputCurrencyId },
    [Field.OUTPUT]: { currencyId: outputCurrencyId },
  } = useSwapState()
  const inputToken = useCurrency(inputCurrencyId)
  const outputToken = useCurrency(outputCurrencyId)

  if (!inputToken || !outputToken) {
    return { inputAmount: undefined, outputAmount: undefined }
  }

  const usdt2tx8 = inputCurrencyId === USDT.address
  const independentToken = independentField === Field.INPUT ? inputToken : outputToken
  const dependentToken = independentField === Field.INPUT ? outputToken : inputToken
  const independentAmount = tryParseAmount(typedValue, independentToken)

  const dependentAmount = tryParseAmount(
    (usdt2tx8 !== (independentField === Field.INPUT)
      ? independentAmount?.divide(USDT_TO_TX8_RATE)
      : independentAmount?.multiply(USDT_TO_TX8_RATE)
    )?.toSignificant(6),
    dependentToken,
  )

  return {
    inputAmount: independentField === Field.INPUT ? independentAmount : dependentAmount,
    outputAmount: independentField === Field.INPUT ? dependentAmount : independentAmount,
  }
}

const WeiUnit = {
  6: 'mwei', // mainnet
  18: 'ether', // testnet
}

class HandledError extends Error {}

type SwapType = {
  inputAmount?: CurrencyAmount
  outputAmount?: CurrencyAmount
  swap: () => Promise<void>
  approve: () => Promise<void>
  resetAllowance: () => Promise<void>
  swapping: boolean
  resetting: boolean
  approving: boolean
  isApproveNecessary: boolean
  isResetNecessary: boolean
}

export const useSwap = (): SwapType => {
  // info
  const {
    independentField,
    typedValue,
    [Field.INPUT]: { currencyId: inputCurrencyId },
    [Field.OUTPUT]: { currencyId: outputCurrencyId },
  } = useSwapState()
  const inputToken = useCurrency(inputCurrencyId)
  const outputToken = useCurrency(outputCurrencyId)

  const { inputAmount, outputAmount } = useMemo(() => {
    if (!inputToken || !outputToken) {
      return { inputAmount: undefined, outputAmount: undefined }
    }

    const usdt2tx8 = inputCurrencyId === USDT.address
    const independentToken = independentField === Field.INPUT ? inputToken : outputToken
    const dependentToken = independentField === Field.INPUT ? outputToken : inputToken
    const independentAmount = tryParseAmount(typedValue, independentToken)

    const dependentAmount = tryParseAmount(
      (usdt2tx8 !== (independentField === Field.INPUT)
        ? independentAmount?.divide(USDT_TO_TX8_RATE)
        : independentAmount?.multiply(USDT_TO_TX8_RATE)
      )?.toSignificant(6),
      dependentToken,
    )

    return {
      inputAmount: independentField === Field.INPUT ? independentAmount : dependentAmount,
      outputAmount: independentField === Field.INPUT ? dependentAmount : independentAmount,
    }
  }, [independentField, inputCurrencyId, inputToken, outputToken, typedValue])

  // actions
  const { account } = useActiveWeb3React()
  const [approving, setApproving] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [allowed, setAllowed] = useState(new BN(0))
  const tx8TokenContract = useTokenContract(TX8.address)
  const usdtTokenContract = useTokenContract(USDT.address)
  const swapContract = useTx8SwapContract()
  const { toastError, toastSuccess } = useToast()
  const { t } = useTranslation()

  const usdt2tx8 = useMemo(() => (inputAmount ? inputAmount.currency.symbol === USDT.symbol : undefined), [inputAmount])
  const amount = useMemo(
    () =>
      inputAmount
        ? new BN(Web3.utils.toWei(inputAmount.toExact(), usdt2tx8 ? WeiUnit[USDT.decimals] : 'ether'))
        : undefined,
    [inputAmount, usdt2tx8],
  )
  const source = useMemo(
    () => (usdt2tx8 ? usdtTokenContract : tx8TokenContract),
    [tx8TokenContract, usdt2tx8, usdtTokenContract],
  )

  // useWhyDidYouUpdate('amount', { inputAmount, usdt2tx8 })
  // useWhyDidYouUpdate('inputAmount', { independentField, inputCurrencyId, inputToken, outputToken, typedValue })

  useEffect(() => {
    source
      .allowance(account, swapContract.address)
      .then((_allowed: BigNumber) => {
        if (!amount) {
          return
        }
        setAllowed(new BN(_allowed.toString()))
      })
      .catch(console.warn)
  }, [account, amount, source, swapContract.address])

  const resetAllowance = useCallback(async () => {
    try {
      setResetting(true)
      try {
        if (!allowed) {
          return
        }
        const resetAllowedTx = await source.approve(swapContract.address, 0)
        const resetResult = await resetAllowedTx.wait()
        if (!resetResult.status) {
          throw new HandledError('Reset failed.')
        }
        setAllowed(new BN(0))
        toastSuccess(t('Success'))
      } catch (resetError) {
        toastError(t('An error occurred resetting allowance'))
        const error = { ...resetError, message: `Reset Allowance error: ${resetError.message}` }
        throw error
      }
    } catch (e) {
      console.error('Error during Reset Allowance transaction', e)
    } finally {
      setResetting(false)
    }
  }, [allowed, source, swapContract.address, t, toastError, toastSuccess])

  const approve = useCallback(async () => {
    if (!amount) {
      return
    }

    try {
      setApproving(true)
      try {
        const approveTx = await source.approve(swapContract.address, amount.toString())
        const approveResult = await approveTx.wait()
        if (!approveResult?.status) {
          throw new HandledError('Approve failed.')
        }
        setAllowed(new BN(amount))
        toastSuccess(t('Success'))
      } catch (approveError) {
        toastError(t('An error occurred approving transaction'))
        const error = { ...approveError, message: `Approve error: ${approveError.message}` }
        throw error
      }
    } catch (e) {
      console.error('Error during Approve transaction', e)
    } finally {
      setApproving(false)
    }
  }, [amount, source, swapContract.address, t, toastError, toastSuccess])

  const swap = useCallback(async () => {
    if (!amount) {
      return
    }

    setSwapping(true)
    try {
      try {
        const swapTx = await swapContract.swap(amount.toString(), usdt2tx8)
        const swapResult = await swapTx.wait()
        if (!swapResult?.status) {
          throw new HandledError('Swap failed.')
        }
        toastSuccess(t('Success'))
      } catch (swapError) {
        toastError(t('An error occurred during swap transaction'))
        const error = { ...swapError, message: `Approve error: ${swapError.message}` }
        throw error
      }
    } catch (e) {
      console.error('Error during Swap transaction', e)
    } finally {
      setSwapping(false)
    }
  }, [amount, swapContract, t, toastError, toastSuccess, usdt2tx8])

  return {
    inputAmount,
    outputAmount,
    swap,
    approve,
    resetAllowance,
    swapping,
    approving,
    resetting,
    isApproveNecessary: amount && allowed.lt(amount),
    isResetNecessary: !allowed.eqn(0) && amount && allowed.lt(amount),
  }
}
