import { FooterLinkType } from '@pancakeswap/uikit'
import { ContextApi } from 'contexts/Localization/types'

export const footerLinks: (t: ContextApi['t']) => FooterLinkType[] = (t) => [
  {
    label: t('Win'),
    items: [
      {
        label: t('Lottery'),
        href: 'https://docs.pancakeswap.finance/contact-us',
      },
     
    ],
  },
  {
    label: t('Trade'),
    items: [
      {
        label: t('Exchange'),
        href: 'https://docs.pancakeswap.finance/contact-us/customer-support',
      },
     
    ],
  },
]
