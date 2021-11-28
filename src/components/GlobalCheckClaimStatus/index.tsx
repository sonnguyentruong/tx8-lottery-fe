import React, { useEffect, useRef } from 'react'
import { useWeb3React } from '@web3-react/core'

interface GlobalCheckClaimStatusProps {
  excludeLocations: string[]
}

/**
 * This is represented as a component rather than a hook because we need to keep it
 * inside the Router.
 *
 * TODO: Put global checks in redux or make a generic area to house global checks
 */
const GlobalCheckClaimStatus: React.FC<GlobalCheckClaimStatusProps> = () => {
  const hasDisplayedModal = useRef(false)
  const { account } = useWeb3React()

  // Reset the check flag when account changes
  useEffect(() => {
    hasDisplayedModal.current = false
  }, [account, hasDisplayedModal])

  return null
}

export default GlobalCheckClaimStatus
