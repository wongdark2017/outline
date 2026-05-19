import styled from "styled-components";
import { useTranslation } from "react-i18next";
import Empty from "~/components/Empty";
import Fade from "~/components/Fade";
import Flex from "~/components/Flex";

export default function FullscreenLoading() {
  const { t } = useTranslation();

  return (
    <Fade timing={500}>
      <Centered>
        <Empty>{`${t("Loading")}…`}</Empty>
      </Centered>
    </Fade>
  );
}

const Centered = styled(Flex)`
  text-align: center;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
`;
