# @trace-ux/tracker

TraceUX session replay, application logs, custom activities, feedback, and an
optional in-product widget.

```bash
npm install @trace-ux/tracker
```

```ts
import { init } from '@trace-ux/tracker';

const traceux = init({
  siteKey: 'YOUR_SITE_KEY',
  origin: 'https://traceux.example.com',
  userId: currentUser?.id,
  widget: true,
});

traceux.identify({ userId: user.id });
traceux.track('checkout_completed');
traceux.setUserStatus('active');
traceux.warn('Checkout request failed', { orderId });
```

`origin` is required for npm and React usage. It must be registered for the
site in TraceUX so browser CORS checks allow the application origin.

The core import has no import-time side effects. The widget is loaded only when
`widget: true` is passed and the site's server configuration enables a widget
section. React applications can use `TraceUXProvider` and `useTraceUX` from
`@trace-ux/tracker/react`.

HTML and Google Tag Manager installations continue to use the `/t.js` snippet
served by the TraceUX server.
