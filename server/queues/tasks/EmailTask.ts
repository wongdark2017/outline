import emails from "@server/emails/templates";
import { createEmailSigninError } from "@server/utils/emailSigninRedaction";
import { BaseTask } from "./base/BaseTask";

type Props = {
  templateName: string;
  props: Record<string, unknown>;
};

export default class EmailTask extends BaseTask<Props> {
  /**
   * Send an email without returning rendered data to the task queue.
   *
   * @param input the template name and serialized metadata.
   * @returns a promise resolving after delivery or a business skip.
   * @throws a safe error for sign-in delivery failures.
   */
  public async perform({
    templateName,
    props,
    ...metadata
  }: Props): Promise<void> {
    const EmailClass = emails[templateName];
    if (!EmailClass) {
      throw new Error(
        `Email task "${templateName}" template does not exist. Check the file name matches the class name.`
      );
    }

    // @ts-expect-error We won't instantiate an abstract class
    const email = new EmailClass(props, metadata);
    try {
      await email.send();
    } catch (error) {
      if (templateName === "SigninEmail") {
        throw createEmailSigninError("task", error);
      }
      throw error;
    }
  }
}
