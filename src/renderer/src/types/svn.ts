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

export type EditorId = 'vscode' | 'vscode-insiders'

export interface EditorOption {
  id: EditorId
  label: string
}

export interface FileChange {
  path: string
  status: 'M' | 'A' | 'D' | '?' | 'C' | '!' | 'R'
  checked: boolean
  displayPath: string
}

export interface BlameLine {
  lineNum: number
  revision: number
  author: string
  date: string
  content: string
}

export interface ConflictContent {
  mine: string
  theirs: string
  base: string
}

export type ConflictAccept = 'mine-full' | 'theirs-full' | 'working'

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

export interface RemoteSearchResult {
  path: string
  name: string
  kind: 'dir' | 'file' | 'revision'
  matchType: 'name' | 'content' | 'comment'
  entryUrl: string
  revision?: number
  revisionMessage?: string
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
