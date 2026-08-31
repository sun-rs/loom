import type { ComputerAttachmentStorePort } from "./computer-attachment-manager.ts";
import type { ComputerAttachmentManagerSnapshot } from "./computer-attachment-manager.ts";

export type ComputerDoctorCheckStatus = "fail" | "pass" | "warn";

export type ComputerDoctorCheck = {
  id: string;
  message: string;
  status: ComputerDoctorCheckStatus;
};

export type ComputerDoctorReport = {
  checks: ComputerDoctorCheck[];
  status: "degraded" | "healthy" | "unconfigured";
};

export type ComputerDoctorOptions = {
  attachmentSnapshot?: () => ComputerAttachmentManagerSnapshot;
  attachmentStore: ComputerAttachmentStorePort;
};

/** A credential-safe, read-only diagnosis projection for the resident service. */
export class ComputerDoctor {
  readonly #attachmentSnapshot:
    ComputerDoctorOptions["attachmentSnapshot"] | undefined;
  readonly #attachmentStore: ComputerAttachmentStorePort;

  constructor(options: ComputerDoctorOptions) {
    this.#attachmentSnapshot = options.attachmentSnapshot;
    this.#attachmentStore = options.attachmentStore;
  }

  async run(): Promise<ComputerDoctorReport> {
    const checks: ComputerDoctorCheck[] = [];
    let attachments;
    try {
      attachments = await this.#attachmentStore.read();
    } catch {
      return {
        checks: [
          {
            id: "attachment-catalog",
            message: "Computer attachment catalog could not be read safely",
            status: "fail",
          },
        ],
        status: "degraded",
      };
    }

    if (attachments.length === 0) {
      return {
        checks: [
          {
            id: "attachment-catalog",
            message: "No Computer control attachment is configured",
            status: "warn",
          },
        ],
        status: "unconfigured",
      };
    }
    checks.push({
      id: "attachment-catalog",
      message: `${String(attachments.length)} Computer attachment(s) loaded from owner-private storage`,
      status: "pass",
    });

    let managerSnapshot: ComputerAttachmentManagerSnapshot | undefined;
    if (this.#attachmentSnapshot !== undefined) {
      try {
        managerSnapshot = this.#attachmentSnapshot();
      } catch {
        checks.push({
          id: "attachment-manager",
          message: "Computer attachment manager status is unavailable",
          status: "fail",
        });
      }
    }

    const attachmentIds = new Set(
      attachments.map((attachment) => attachment.attachmentId),
    );
    for (const attachment of attachments) {
      const id = `attachment:${attachment.attachmentId}`;
      const projection = managerSnapshot?.attachments[attachment.attachmentId];
      if (projection === undefined) {
        checks.push({
          id,
          message: "Attachment has not been reconciled by the resident service",
          status: "warn",
        });
        continue;
      }
      if (projection.state === "connected") {
        checks.push({
          id,
          message: "Attachment control session is connected",
          status: "pass",
        });
      } else if (projection.state === "degraded") {
        checks.push({
          id,
          message:
            projection.terminalReason === "attachment_revoked"
              ? "Attachment credential was revoked; explicit re-attachment is required"
              : "Attachment is parked by a terminal configuration failure",
          status: "fail",
        });
      } else {
        checks.push({
          id,
          message:
            projection.state === "disconnected"
              ? "Attachment is disconnected and will be retried"
              : `Attachment resident state is ${projection.state}`,
          status: "warn",
        });
      }
    }

    if (managerSnapshot !== undefined) {
      for (const attachmentId of Object.keys(managerSnapshot.attachments)) {
        if (attachmentIds.has(attachmentId)) continue;
        checks.push({
          id: `attachment:${attachmentId}`,
          message: "Resident projection has no matching durable attachment",
          status: "fail",
        });
      }
    }

    return {
      checks,
      status: checks.every((check) => check.status === "pass")
        ? "healthy"
        : "degraded",
    };
  }
}
