export interface Credentials {
  username: string
  password: string
  serverUrl: string
}

export interface RemoteServer {
  id: string
  name: string
  url: string
  createdAt: string
  active?: boolean
}

export interface LocalRepo {
  name: string
  path: string
  url: string
  revision: number
  lastUpdated: string
  changesCount: number
}

export interface FileChange {
  path: string
  status: 'M' | 'A' | 'D' | '?' | 'C' | '!' | 'R'
  checked: boolean
  displayPath: string
}

export interface LogEntry {
  revision: number
  author: string
  date: string
  message: string
  paths: LogPath[]
}

export interface LogPath {
  path: string
  action: 'A' | 'M' | 'D' | 'R'
}

export interface RemoteEntry {
  name: string
  url: string
  kind: 'dir' | 'file'
  revision: number
  author: string
  date: string
  children?: RemoteEntry[]
  expanded?: boolean
  loading?: boolean
  isCheckedOut: boolean
  localPath?: string
}

export interface SvnInfo {
  url: string
  revision: number
  author: string
  date: string
  rootUrl: string
}

export interface CheckoutProgress {
  message: string
  done: boolean
  error?: string
}

export type ActiveTab = 'changes' | 'history' | 'explorer'
