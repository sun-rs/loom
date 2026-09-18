import { NotFoundError, type RoomKernel } from "@rah-os/core";
import type { AuthenticatedHostContext } from "@rah-os/core";

/**
 * Turns a driver's acceptance signal into the Host-credential registration
 * that the presented window's implicit acknowledgement gate requires.
 *
 * The Host credential is used here and the worker credential never is: the
 * model holds the latter, and the whole point of the `sent_at` column is that
 * the two identities are different.
 *
 * A RunAttempt whose wake input was never fetched through `message-present`
 * has no rendering to register. That is the normal state until the
 * render-and-inject hop lands, so it is a no-op rather than a failure; every
 * other error still surfaces.
 */
export function deliveryAcceptanceRegistration(
  kernel: Pick<RoomKernel, "markPresentedDeliverySent">,
  host: AuthenticatedHostContext,
): (input: {
  activationId: string;
  consumerId: string;
  runAttemptId: string;
}) => void {
  return (registration) => {
    try {
      kernel.markPresentedDeliverySent(host, registration);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  };
}
