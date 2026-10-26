// @vitest-isolate true
import Queue from "bull";
import Logger from "@server/logging/Logger";
import { createEmailSigninError } from "@server/utils/emailSigninRedaction";
import { createQueue } from "./queue";

interface FailedJob {
  data: object;
  opts: { attempts: number };
  attemptsMade: number;
  id: string;
}

function isFailedListener(
  listener: unknown
): listener is (job: FailedJob, error: Error) => void {
  return typeof listener === "function";
}

describe("sign-in queue failure logs", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    {
      name: "EmailTask",
      props: {
        templateName: "SigninEmail",
        props: {
          to: "private@example.com",
          code: "123456",
          token: "private-token",
          requestIp: "192.0.2.1",
          userAgent: "private-agent",
        },
      },
    },
    {
      props: {
        templateName: "SigninEmail",
        props: { code: "123456", token: "private-token" },
      },
    },
  ])(
    "summarizes malformed and legacy sign-in failures without private job data",
    (data) => {
      const listeners = vi.spyOn(Queue.prototype, "on");
      const logs = vi
        .spyOn(Logger, "error")
        .mockImplementation(() => undefined);
      createQueue("confidential-test");
      const failed = listeners.mock.calls.find(
        ([event]) => event === "failed"
      )?.[1];
      if (!isFailedListener(failed)) {
        throw new Error("Queue failure listener is missing");
      }
      const original = Object.assign(new Error("123456 private-token"), {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH LOGIN private-token",
        cause: new Error("private-token"),
      });

      failed(
        { data, opts: { attempts: 1 }, attemptsMade: 0, id: "private-job-id" },
        createEmailSigninError("task", original)
      );

      expect(logs).toHaveBeenCalledWith(
        "Sign-in email job failed",
        expect.any(Error),
        { templateName: "SigninEmail" }
      );
      const loggedError = logs.mock.calls[0]?.[1];
      expect(loggedError).not.toBe(original);
      expect(loggedError?.message).toBe("Sign-in email task failed");
      expect(loggedError).toMatchObject({
        name: "Error",
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH LOGIN",
      });
      expect(loggedError?.stack).not.toMatch(/123456|private-token/);
      expect(loggedError).not.toHaveProperty("cause");
      expect(JSON.stringify(logs.mock.calls)).not.toMatch(
        /123456|private-token|private@example|192\.0\.2\.1|private-agent|private-job-id/
      );
    }
  );

  it("preserves unrelated queue failure reporting", () => {
    const listeners = vi.spyOn(Queue.prototype, "on");
    const logs = vi.spyOn(Logger, "error").mockImplementation(() => undefined);
    createQueue("ordinary-test");
    const failed = listeners.mock.calls.find(
      ([event]) => event === "failed"
    )?.[1];
    if (!isFailedListener(failed)) {
      throw new Error("Queue failure listener is missing");
    }
    const original = new Error("ordinary failure");
    const data = { name: "EmailTask", props: { templateName: "InviteEmail" } };
    failed(
      { data, opts: { attempts: 1 }, attemptsMade: 0, id: "job-id" },
      original
    );
    expect(logs).toHaveBeenCalledWith(
      "Job failed in ordinary-test queue",
      original,
      expect.objectContaining({ data })
    );
  });
});
