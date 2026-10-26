// @vitest-isolate true
import Logger from "@server/logging/Logger";
import {
  globalEventQueue,
  processorEventQueue,
  taskQueue,
} from "@server/queues";
import HealthMonitor from "@server/queues/HealthMonitor";
import EmailTask from "@server/queues/tasks/EmailTask";
import { initI18n } from "@server/utils/i18n";
import { createEmailSigninError } from "@server/utils/emailSigninRedaction";
import init from "./worker";

vi.mock("@server/utils/i18n", () => ({ initI18n: vi.fn() }));

interface TestJob {
  data: {
    name: string;
    props: {
      templateName: string;
      props: Record<string, string>;
    };
  };
  attemptsMade: number;
  opts: { attempts: number };
}

describe("sign-in worker log boundaries", () => {
  const info = vi.fn<typeof Logger.info>();
  const errorLog = vi.fn<typeof Logger.error>();

  beforeEach(() => {
    info.mockClear();
    errorLog.mockClear();
    vi.spyOn(Logger, "info").mockImplementation(info);
    vi.spyOn(Logger, "error").mockImplementation(errorLog);
    vi.spyOn(HealthMonitor, "start").mockImplementation(() => undefined);
    vi.spyOn(globalEventQueue(), "process").mockResolvedValue();
    vi.spyOn(processorEventQueue(), "process").mockResolvedValue();
  });

  afterEach(() => vi.restoreAllMocks());

  it("redacts running and failed legacy sign-in jobs before and after dispatch", async () => {
    const processing = vi.spyOn(taskQueue(), "process").mockResolvedValue();
    const original = Object.assign(new Error("123456 private-token"), {
      name: "TimeoutError",
      code: "ETIMEDOUT",
      command: "CONN",
      cause: new Error("private-token"),
    });
    vi.spyOn(EmailTask.prototype, "perform").mockRejectedValue(
      createEmailSigninError("task", original)
    );
    await init();
    expect(initI18n).toHaveBeenCalled();
    const callbacks: unknown[] = processing.mock.calls.flat();
    const handler = callbacks.find(
      (value): value is (job: TestJob) => Promise<unknown> =>
        typeof value === "function"
    );
    if (!handler) {
      throw new Error("Task handler is missing");
    }

    const error = await handler({
      data: {
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
      attemptsMade: 0,
      opts: { attempts: 1 },
    }).catch((failure: Error) => failure);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(original);
    expect(error).not.toHaveProperty("cause");
    expect(error).toMatchObject({
      name: "TimeoutError",
      code: "ETIMEDOUT",
      command: "CONN",
    });
    expect(info).toHaveBeenCalledWith("worker", "EmailTask running", {
      templateName: "SigninEmail",
    });
    expect(errorLog).toHaveBeenCalledWith(
      "Error processing task in EmailTask",
      expect.any(Error),
      { templateName: "SigninEmail" }
    );
    expect(
      JSON.stringify([...info.mock.calls, ...errorLog.mock.calls, error])
    ).not.toMatch(
      /123456|private-token|private@example|192\.0\.2\.1|private-agent/
    );
    expect(error instanceof Error ? error.stack : "").not.toMatch(
      /123456|private-token/
    );
  });
});
