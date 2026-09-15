import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { init, type TraceUXHandle, type TraceUXOptions } from './main';

export interface TraceUXProviderProps extends TraceUXOptions {
  children?: ReactNode;
  /** Called after the provider has created the shared tracker handle. */
  onReady?: (tracker: TraceUXHandle) => void;
  /** Stop the tracker when this provider leaves the tree. Defaults to true. */
  stopOnUnmount?: boolean;
}

const TraceUXContext = createContext<TraceUXHandle | null>(null);

/**
 * Initializes one tracker for the provider tree and makes it available to
 * descendants. Identity props can change after login; those changes are
 * forwarded through identify() without creating a second recorder.
 */
export function TraceUXProvider(props: TraceUXProviderProps) {
  const { children, onReady, stopOnUnmount = true, ...options } = props;
  const trackerRef = useRef<TraceUXHandle | null>(null);
  const identityEffectRef = useRef(false);
  const mountedRef = useRef(false);
  if (!trackerRef.current) trackerRef.current = init(options);
  const tracker = trackerRef.current;

  useEffect(() => {
    mountedRef.current = true;
    onReady?.(tracker);
    return () => {
      mountedRef.current = false;
      if (stopOnUnmount) {
        // The delayed cleanup lets React StrictMode remounts reuse the same
        // handle without stopping it between the development-only passes.
        setTimeout(() => {
          if (!mountedRef.current) tracker.stop();
        }, 0);
      }
    };
  }, [onReady, stopOnUnmount, tracker]);

  useEffect(() => {
    if (!identityEffectRef.current) {
      identityEffectRef.current = true;
      return;
    }
    tracker.identify({
      userId: options.userId,
      clientId: options.clientId,
      remoteId: options.remoteId,
    });
  }, [options.clientId, options.remoteId, options.userId, tracker]);

  return createElement(TraceUXContext.Provider, { value: tracker }, children);
}

/** Read the tracker initialized by the nearest TraceUXProvider. */
export function useTraceUX(): TraceUXHandle {
  const tracker = useContext(TraceUXContext);
  if (!tracker) {
    throw new Error('useTraceUX must be used inside a TraceUXProvider.');
  }
  return tracker;
}
