import { BeakerIcon } from "outline-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";

interface DemoInfoResponse {
  data: {
    message: string;
    teamName: string;
    userName: string;
  };
}

export default function DemoSettings() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string>();

  const handleClick = async () => {
    setIsLoading(true);

    try {
      const res = await client.post<DemoInfoResponse>("/demo.info");
      setResult(
        `${res.data.message} ${res.data.userName} @ ${res.data.teamName}`
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Scene title={t("Demo")} icon={<BeakerIcon />}>
      <Heading>{t("Demo")}</Heading>
      <Text as="p" type="secondary">
        {t("This page is provided by the demo plugin.")}
      </Text>
      <p>
        <Button
          type="button"
          icon={<BeakerIcon />}
          disabled={isLoading}
          onClick={handleClick}
        >
          {isLoading ? `${t("Loading")}…` : t("Call plugin API")}
        </Button>
      </p>
      {result && <Text as="p">{result}</Text>}
    </Scene>
  );
}
