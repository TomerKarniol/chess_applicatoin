import nodemailer, { type Transporter } from 'nodemailer';
import { childLogger } from '../../shared/logger.js';
import type { Env } from '../../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailService {
  send(message: EmailMessage): Promise<void>;
  /**
   * Probe the transport so misconfiguration (bad host, wrong port, bad
   * credentials) is caught loudly at startup instead of being discovered as a
   * swallowed failure on the first password-reset attempt. Resolves when the
   * transport is reachable; rejects with the underlying error otherwise.
   */
  verify(): Promise<void>;
  /** Human-friendly identifier — surfaced by the boot log so ops can tell which transport is live. */
  readonly transportName: string;
}

const log = childLogger({ component: 'email' });

/**
 * Dev / fallback transport. Writes the email to the structured logger and is
 * never used when SMTP credentials are configured. The reset code is shown in
 * full so a developer can step through the forgot-password flow without
 * needing a real inbox.
 */
export class ConsoleEmailService implements EmailService {
  public readonly transportName = 'console';

  /** The console transport is always "reachable" — it just logs. */
  verify(): Promise<void> {
    return Promise.resolve();
  }

  send(message: EmailMessage): Promise<void> {
    log.info(
      {
        to: message.to,
        subject: message.subject,
        // The text body for transactional emails fits comfortably in a log line.
        body: message.text,
      },
      `[dev email] ${message.subject}`,
    );
    return Promise.resolve();
  }
}

/**
 * Real SMTP transport. Designed for Gmail with an App Password (see .env.example)
 * but works with any standards-compliant SMTP server.
 */
export class SmtpEmailService implements EmailService {
  public readonly transportName: string;
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(opts: {
    host: string;
    port: number;
    secure: boolean;
    user: string | undefined;
    pass: string | undefined;
    from: string;
  }) {
    this.transportName = `smtp:${opts.host}:${opts.port}`;
    this.from = opts.from;
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth:
        opts.user && opts.pass
          ? { user: opts.user, pass: opts.pass }
          : undefined,
    });
  }

  /** Open + authenticate an SMTP connection without sending anything. */
  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

/**
 * Pick the right transport from the configured environment. If SMTP is not
 * configured we silently fall back to the console transport — appropriate
 * for local dev and tests; surfaces a warning in production.
 */
export function buildEmailService(env: Env): EmailService {
  const host = env.SMTP_HOST?.trim();
  if (!host) {
    if (env.NODE_ENV === 'production') {
      log.warn('SMTP_HOST is not set in production; falling back to ConsoleEmailService.');
    }
    return new ConsoleEmailService();
  }
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    log.warn(
      { host },
      'SMTP_HOST is set but SMTP_USER/SMTP_PASS are missing — most providers (incl. Gmail) require authentication and will reject the connection.',
    );
  }
  const from = env.SMTP_FROM?.trim() || env.SMTP_USER || 'no-reply@example.com';
  return new SmtpEmailService({
    host,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from,
  });
}
