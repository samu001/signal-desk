import { Redirect } from 'expo-router';

/** Desk research now lives on Dashboard (Research expand / Refresh signals). */
export default function DeskRedirect() {
  return <Redirect href="/" />;
}
