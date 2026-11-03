import { GithubLogoIcon } from '@phosphor-icons/react'
import { registerObjectUI } from '../canvas/registry'
import { GithubObject } from './GithubObject'

registerObjectUI('github', { View: GithubObject, tool: { key: 'G', label: 'GitHub', Icon: GithubLogoIcon }, editable: true, editOnCreate: true, isEmpty: (o) => !o.url })
