import { FooterLinkType } from '@pancakeswap/uikit'
import { ContextApi } from 'contexts/Localization/types'

export const footerLinks: (t: ContextApi['t']) => FooterLinkType[] = (t) => [
  {
    label: t('Win'),
    items: [
      {
        label: t('Lottery'),
        href: '/',
      },
     
    ],
  },
  {
    label: t('Trade'),
    items: [
      {
        label: t('Exchange'),
        href: '/swap',
      },
     
    ],
  },
]
