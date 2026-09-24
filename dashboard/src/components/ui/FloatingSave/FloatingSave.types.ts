export type FloatingSaveProps = {
  /** Shown only while the page has unsaved changes. */
  visible: boolean;
  busy?: boolean;
  label?: string;
  busyLabel?: string;
  disabled?: boolean;
  /** Called on click. Pass `form` instead to submit a form by its id. */
  onSave?: () => void;
  /** Id of the form this button submits. The button is portalled to the
   *  page body, so it is outside the form and links to it by id. */
  form?: string;
};
