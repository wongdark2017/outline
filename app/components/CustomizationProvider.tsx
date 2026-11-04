import { comparer, reaction } from "mobx";
import { observer } from "mobx-react";
import { useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useHistory } from "react-router-dom";
import styled, { useTheme } from "styled-components";
import { HEADER_HEIGHT } from "@shared/constants";
import { depths } from "@shared/styles";
import { WebsocketContext } from "~/components/WebsocketProvider";
import useStores from "~/hooks/useStores";
import {
  CustomizationStyleManager,
  isCustomizationRecoveryRequested,
} from "~/utils/customizations";
import Logger from "~/utils/Logger";
import { AuthorizationError, NotFoundError } from "~/utils/errors";
import { getPageVisible, getVisibilityListener } from "~/utils/pageVisibility";

interface Props {
  children: ReactNode;
}

interface BackgroundSession {
  invalidate: () => void;
}

/**
 * Applies saved backgrounds only inside the authenticated application. User CSS
 * and scripts remain paused, including source retained by an older response.
 *
 * @param props the authenticated application content.
 * @returns the application and its stable, inactive extension mount.
 */
export const CustomizationProvider = observer(function CustomizationProvider({
  children,
}: Props) {
  const { auth, customizations } = useStores();
  const history = useHistory();
  const socket = useContext(WebsocketContext);
  const theme = useTheme();
  const userId = auth.currentUserId;
  const teamId = auth.currentTeamId;
  const [session, setSession] = useState<BackgroundSession | null>(null);
  const [recoveryAtMount] = useState(() =>
    isCustomizationRecoveryRequested(history.location.search)
  );

  useEffect(() => {
    document.body.style.setProperty(
      "--outline-customization-surface",
      theme.background
    );

    return () => {
      document.body.style.removeProperty("--outline-customization-surface");
    };
  }, [theme.background]);

  useEffect(() => {
    if (!userId || !teamId) {
      return;
    }

    let disposed = false;
    let recovery = recoveryAtMount;
    let printing = false;
    let refreshAgain = false;
    let refreshing: Promise<void> | undefined;
    const styles = new CustomizationStyleManager(document);
    const currentIdentity = () =>
      !disposed &&
      auth.currentUserId === userId &&
      auth.currentTeamId === teamId;

    const apply = () => {
      if (!currentIdentity() || recovery || printing) {
        styles.clear();
        return;
      }

      const background = customizations.effectiveBackground;
      styles.apply({
        backgroundUrl: background?.asset?.url,
        backgroundFit: background?.fit ?? "cover",
        workspaceCss: "",
        personalCss: "",
      });
    };

    const refresh = (): Promise<void> => {
      if (disposed) {
        return Promise.resolve();
      }
      if (refreshing) {
        refreshAgain = true;
        return refreshing;
      }

      refreshing = (async () => {
        let supersededRetries = 0;
        do {
          refreshAgain = false;
          try {
            const info = await customizations.revalidate();
            if (!currentIdentity()) {
              return;
            }
            if (!refreshAgain && info) {
              apply();
            } else if (!info && supersededRetries < 1) {
              supersededRetries += 1;
              refreshAgain = true;
            }
          } catch (error) {
            if (currentIdentity()) {
              if (
                error instanceof AuthorizationError ||
                error instanceof NotFoundError
              ) {
                customizations.clear();
                styles.clear();
              }
              Logger.warn("Failed to revalidate customizations", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } while (refreshAgain && currentIdentity());
      })().finally(() => {
        refreshing = undefined;
      });

      return refreshing;
    };

    const backgroundSession: BackgroundSession = {
      invalidate: () => {
        if (currentIdentity()) {
          void refresh();
        }
      },
    };

    customizations.clear();
    const disposeSettings = reaction(
      () => [
        auth.currentUserId,
        auth.currentTeamId,
        customizations.effectiveBackground?.asset?.url,
        customizations.effectiveBackground?.fit,
      ],
      apply,
      { fireImmediately: true, equals: comparer.shallow }
    );
    const unlisten = history.listen((location) => {
      if (isCustomizationRecoveryRequested(location.search)) {
        recovery = true;
        apply();
      }
    });
    const handleVisibility = () => {
      if (getPageVisible()) {
        void refresh();
      }
    };
    const handleBeforePrint = () => {
      printing = true;
      apply();
    };
    const handleAfterPrint = () => {
      printing = false;
      void refresh();
    };
    const printMedia = window.matchMedia("print");
    const handlePrintMedia = (event: MediaQueryListEvent) => {
      if (event.matches) {
        handleBeforePrint();
      } else {
        handleAfterPrint();
      }
    };
    const poll = window.setInterval(() => {
      if (getPageVisible()) {
        void refresh();
      }
    }, 30_000);

    document.addEventListener(getVisibilityListener(), handleVisibility);
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);
    printMedia.addEventListener("change", handlePrintMedia);
    setSession(backgroundSession);
    void refresh();

    return () => {
      disposed = true;
      disposeSettings();
      unlisten();
      window.clearInterval(poll);
      document.removeEventListener(getVisibilityListener(), handleVisibility);
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
      printMedia.removeEventListener("change", handlePrintMedia);
      styles.dispose();
      customizations.clear();
      setSession((current) => (current === backgroundSession ? null : current));
    };
  }, [auth, customizations, userId, teamId, history, recoveryAtMount]);

  useEffect(() => {
    if (!socket || !session) {
      return;
    }

    socket.on("customizations.update", session.invalidate);
    socket.on("unauthorized", session.invalidate);
    socket.on("authenticated", session.invalidate);
    if (socket.authenticated) {
      session.invalidate();
    }

    return () => {
      socket.off("customizations.update", session.invalidate);
      socket.off("unauthorized", session.invalidate);
      socket.off("authenticated", session.invalidate);
    };
  }, [socket, session]);

  return (
    <>
      {children}
      <ExtensionMount data-outline-part="extension-root" />
    </>
  );
});

const ExtensionMount = styled.div`
  position: fixed;
  top: ${HEADER_HEIGHT + 8}px;
  inset-inline-end: 16px;
  z-index: ${depths.header + 1};

  &:empty {
    display: none;
  }

  @media print {
    display: none;
  }
`;
