export class CommerceSdkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends CommerceSdkError {}
export class ValidationError extends CommerceSdkError {}
export class SettlementError extends CommerceSdkError {
  constructor(
    message: string,
    readonly transactionHash?: string,
    options?: { cause?: unknown; status?: "submitted" | "failed" },
  ) {
    super(message, options);
    this.status = options?.status;
  }
  readonly status?: "submitted" | "failed";
}
export class AuditError extends CommerceSdkError {
  constructor(
    message: string,
    readonly eventId?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
