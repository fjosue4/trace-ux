# @trace-ux/tracker

Session replay, application logs, custom activities, feedback and an optional
in-product widget for [TraceUX](https://github.com/fjosue4/trace-ux) — the
self-hosted UX bundle. Recordings go to **your** server, not a vendor's.

**[Live demo →](https://trace-ux.builtbyfrank.dev/)** · [Repository](https://github.com/fjosue4/trace-ux) · [Report an issue](https://github.com/fjosue4/trace-ux/issues)

```bash
npm install @trace-ux/tracker
```

You need a running TraceUX server and a site key from its dashboard. If you
only want the script tag, you do not need this package — the server serves
`/t.js` and nothing here changes that.

---

## Quick start

```ts
import { init } from '@trace-ux/tracker';

const traceux = init({
  siteKey: 'YOUR_SITE_KEY',
  origin: 'https://traceux.example.com',
  userId: currentUser?.id,
});

traceux.identify({ userId: user.id });   // after login
traceux.track('checkout_completed');
```

`origin` is **required** here. The script-tag build infers it from its own
`src`; an npm consumer has no script URL to read, so it must be passed. It also
has to be registered as the site's URL in the dashboard, or the browser's CORS
check will reject the requests.

Importing the package does nothing on its own — there are no import-time side
effects, and recording starts only when you call `init()`.

## Options

| Option | Type | Required | Notes |
| --- | --- | --- | --- |
| `siteKey` | `string` | yes | From the site's page in the dashboard. |
| `origin` | `string` | yes | Your TraceUX server, e.g. `https://traceux.example.com`. |
| `userId` | `string` | no | Your own user id. Also settable later via `identify()`. |
| `clientId` | `string` | no | Tenant/account id, for filtering sessions. |
| `remoteId` | `string` | no | Any third id you filter on. |
| `widget` | `boolean` | no | Opt into the announcements / support / feedback widget. |
| `onAnnouncement` | `(announcement) => void` | no | Called when a newly published or updated announcement reaches the widget. |

## The handle

`init()` returns a handle; every method is also reachable as `window.TraceUX`
for parity with the script tag.

```ts
traceux.identify({ userId, clientId, remoteId });  // attach identity mid-session
traceux.track('checkout_started', 'cta-hero');     // seekable activity in the replay
traceux.track('checkout_error', 'checkout-button', {
  notify: true,
  details: { pathname: location.pathname, errorInfo: 'Payment failed' },
}); // also notify Slack when enabled
traceux.setUserStatus('trialing');                 // lifecycle state as an activity
traceux.updateUserStatus('active');                // alias, for update-style call sites

traceux.debug('cache miss', { key });              // application logs — sent only when
traceux.info('order created', { orderId });        // Logs is enabled for the site and
traceux.warn('retrying payment', { attempt });     // the severity threshold allows it
traceux.error('checkout failed', error);
traceux.log('warn', 'same as warn()', details);

traceux.feedback({ rating: 5, comment: 'Fast checkout' });

const link = await traceux.claimReplay();          // short-lived share link, no session id
traceux.stop();                                    // flush, stop recording, remove listeners
```

When the widget receives a newly published announcement, or a published
announcement is edited, `onAnnouncement` receives the complete announcement
payload. It includes the title, summary, full body, release label, link,
status, timestamps, engagement counts, and any `internal_headers` key/value
metadata configured by the admin:

```ts
const traceux = init({
  siteKey: 'YOUR_SITE_KEY',
  origin: 'https://traceux.example.com',
  widget: true,
  onAnnouncement: (announcement) => {
    console.log(announcement.title);
    console.log(announcement.body);
    console.log(announcement.internal_headers?.current_version);
    // Run application-specific behavior here.
  },
});
```

The callback is not replayed for announcements already present during the
widget's initial load. Internal headers are not rendered in the visitor widget,
but they are delivered to the browser callback, so they must not contain
secrets. Callback errors are isolated so they cannot break the widget or
session recording.

`track` and `setUserStatus` write seekable markers into the replay timeline, so
you can jump straight to the moment in the session. `setUserStatus` does not
create a server-side user record — it is an activity, not a table.

Pass `{ notify: true }` as the third argument to `track` when an event should
also notify Slack. Put structured context in the same options object under
`details`; it is stored with the custom event and included in the Slack
message. The TraceUX admin must enable **Custom events** and configure the
Slack webhook under **Integrations**. The notification includes a button
linking directly to the current session replay. Events without `notify: true`
remain normal replay activity and do not notify. `traceux.info(...)` is a
separate browser log; it does not add details to a custom event.

```ts
traceux.track(
  'user_automatic_error_report',
  'franklin.mendez@replypro.io',
  {
    notify: true,
    details: {
      errorInfo: 'TypeError: Cannot read properties of undefined (reading "id")',
      pathname: '/inbox/interaction/abc123',
    },
  },
);
```

## React

```tsx
import { TraceUXProvider, useTraceUX } from '@trace-ux/tracker/react';

export function App() {
  return (
    <TraceUXProvider siteKey="YOUR_SITE_KEY" origin="https://traceux.example.com" widget>
      <Checkout />
    </TraceUXProvider>
  );
}

function Checkout() {
  const traceux = useTraceUX();
  return <button onClick={() => traceux.track('checkout_started')}>Checkout</button>;
}
```

The provider initializes one tracker for its subtree. Identity props may change
after login; those changes are forwarded through `identify()` rather than
starting a second recorder. `react` is an optional peer dependency — install it
only if you use this entry point.

## The widget is opt-in, and stays out of your bundle

The announcements / support / feedback widget is loaded through a dynamic
`import()`, so bundlers split it into its own chunk and fetch it only when
`widget: true` is passed **and** the server configuration enables at least one
section.

| | Gzipped |
| --- | ---: |
| Core — recording, identity, events, logs | ~27 KB |
| Widget chunk, only when enabled | ~17 KB |

## Script tag and Google Tag Manager

Unchanged, and still the simplest install. The server serves the bundle:

```html
<script async src="https://traceux.example.com/t.js" data-site="YOUR_SITE_KEY"></script>
```

`data-user-id`, `data-client-id` and `data-remote-id` are read at load, and
`window.TraceUX` exposes the same handle.

If a page somehow has both the snippet and an npm integration, the first
tracker to initialize owns the page; the second reuses that handle instead of
recording a duplicate session.

## Browser support

ES2018 targets, with graceful degradation where a capability is missing. The
tracker honours `navigator.doNotTrack` and a `trace_ux_optout` flag in
`localStorage`, and never records a visit when either is set.

## License

[TraceUX Community Source License](https://github.com/fjosue4/trace-ux/blob/main/LICENSE) — see `LICENSE` in the package.
