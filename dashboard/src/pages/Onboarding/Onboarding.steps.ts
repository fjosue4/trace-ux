export type OnboardingStep =
  | 'site'
  | 'install'
  | 'recordings'
  | 'widget'
  | 'logs'
  | 'services'
  | 'slack'
  | 'team'
  | 'done';

export type StepStatus = 'done' | 'skipped';

type StepIcon = 'globe' | 'code' | 'film' | 'settings' | 'activity' | 'slack' | 'users' | 'check';

export type OnboardingStepMeta = {
  id: OnboardingStep;
  label: string;
  title: string;
  description: string;
  icon: StepIcon;
  /** The step edits the site settings draft: "Save and continue" writes it,
   *  and skipping discards it. */
  savesDraft?: boolean;
  continueLabel?: string;
  /** Shown beside the actions, for steps whose controls save themselves. */
  note?: string;
};

// In the order a site is usually brought up. `team` is only offered during the
// very first setup, while the admin is the only user.
export const ONBOARDING_STEPS: OnboardingStepMeta[] = [
  {
    id: 'site',
    label: 'Create site',
    title: 'Which site are you connecting?',
    description: 'Name it and give the origin where the snippet will run. This is the only step you cannot skip.',
    icon: 'globe',
  },
  {
    id: 'install',
    label: 'Install snippet',
    title: 'Install the tracker',
    description: 'Add it with npm, Google Tag Manager, or a plain script tag, then verify it: the first visit to your site confirms the installation.',
    icon: 'code',
  },
  {
    id: 'recordings',
    label: 'Recordings',
    title: 'How recordings are kept',
    description: 'Turn recording on or off, cap concurrent sessions, and choose how long recordings and feedback are kept.',
    icon: 'film',
    savesDraft: true,
  },
  {
    id: 'widget',
    label: 'Widget',
    title: 'The visitor widget',
    description: "Choose what visitors can do from the launcher: send feedback, open support tickets, and read What's new.",
    icon: 'settings',
    savesDraft: true,
  },
  {
    id: 'logs',
    label: 'Logs & severity',
    title: 'Browser logs',
    description: 'Capture console output from visitors, pick exactly which severity levels to keep, and bound how long they are stored.',
    icon: 'code',
    savesDraft: true,
  },
  {
    id: 'services',
    label: 'Services',
    title: 'Backend services',
    description: 'Connect a backend once and use one key for its logs and performance. Skip this if the site has no backend to connect yet.',
    icon: 'activity',
    note: 'Services save as you create them.',
  },
  {
    id: 'slack',
    label: 'Slack alerts',
    title: 'Slack alerts',
    description: 'Send new tickets, matched logs, and flagged events to Slack. Save your changes here before continuing.',
    icon: 'slack',
    note: 'Use Save in the card above before continuing.',
  },
  {
    id: 'team',
    label: 'Invite your team',
    title: 'Invite your team',
    description: 'You are the only user so far. Add admins who can configure sites, or viewers who can browse sessions and replays.',
    icon: 'users',
    note: 'Users are added immediately.',
  },
  {
    id: 'done',
    label: 'Done',
    title: 'Your site is set up',
    description: 'Here is what you configured and what you skipped. Anything skipped can be set up later from the site’s page.',
    icon: 'check',
  },
];
