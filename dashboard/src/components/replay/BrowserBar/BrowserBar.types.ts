/** The page shown in the recorded browser at the current playback moment. */
export type BrowserPage = { url: string; title: string };

/** A URL split the way an address bar shows it. */
export type DisplayURL = {
  /** Served over https: the address bar shows a lock instead of "Not secure". */
  secure: boolean;
  /** Host and port, shown in full ink. Empty when the URL does not parse. */
  host: string;
  /** Path, query and hash, shown muted after the host. */
  rest: string;
  full: string;
};

export type BrowserBarProps = {
  page: BrowserPage | null;
  /** The tab's label. Defaults to the recorded page's title. */
  title?: string;
  /** Closes the recorded browser: the red window light and the tab's ×.
   *  Omitted, both are drawn only. */
  onClose?: () => void;
  /** Accessible name for the close buttons, saying where closing leads. */
  closeLabel?: string;
  /** Seek to the previous page of the visit. Omitted when there is none. */
  onBack?: () => void;
  /** Seek to the next page of the visit. Omitted when there is none. */
  onForward?: () => void;
  /** Seek to the start of the current page. */
  onReload?: () => void;
};
