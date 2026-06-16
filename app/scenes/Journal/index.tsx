import { observer } from "mobx-react";
import { CalendarIcon } from "outline-icons";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useHistory, useParams } from "react-router-dom";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import Heading from "~/components/Heading";
import LoadingIndicator from "~/components/LoadingIndicator";
import Scene from "~/components/Scene";
import useStores from "~/hooks/useStores";
import CalendarGrid from "./components/CalendarGrid";
import RecentEntries from "./components/RecentEntries";

type Params = {
  date?: string;
};

function getRangeStart(endDate: string): string {
  const date = new Date(`${endDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 13);
  return date.toISOString().split("T")[0];
}

function Journal() {
  const { journalEntries } = useStores();
  const history = useHistory();
  const { date } = useParams<Params>();
  const { t } = useTranslation();

  const handleSelectDate = useCallback(
    async (selectedDate: string) => {
      journalEntries.setSelectedDate(selectedDate);

      const documentUrl =
        await journalEntries.fetchOrCreateByDate(selectedDate);
      if (documentUrl) {
        history.push(documentUrl);
      }
    },
    [history, journalEntries]
  );

  useEffect(() => {
    const { year, month } = journalEntries.currentMonth;
    void journalEntries.fetchCalendar(year, month);

    const endDate = journalEntries.today;
    void journalEntries.fetchRange(getRangeStart(endDate), endDate);
  }, [
    journalEntries,
    journalEntries.currentMonth.year,
    journalEntries.currentMonth.month,
  ]);

  useEffect(() => {
    if (date) {
      void handleSelectDate(date);
    }
  }, [date, handleSelectDate]);

  useEffect(() => {
    if (!journalEntries.actionError) {
      return;
    }

    toast.error(journalEntries.actionError);
    journalEntries.clearActionError();
  }, [journalEntries, journalEntries.actionError]);

  const handleChangeMonth = useCallback(
    (year: number, month: number) => {
      journalEntries.setCurrentMonth(year, month);
    },
    [journalEntries]
  );

  return (
    <Scene icon={<CalendarIcon />} title={t("Journal")}>
      <Heading>{t("Journal")}</Heading>
      <Panel>
        <CalendarGrid
          year={journalEntries.currentMonth.year}
          month={journalEntries.currentMonth.month}
          dots={journalEntries.calendarDots}
          selectedDate={journalEntries.selectedDate}
          today={journalEntries.today}
          onSelectDate={handleSelectDate}
          onChangeMonth={handleChangeMonth}
        />
      </Panel>

      {journalEntries.streak > 0 && (
        <StreakInfo>
          {journalEntries.streakCapped
            ? t("366+ day streak")
            : t("{{ count }} day streak", {
                count: journalEntries.streak,
              })}
        </StreakInfo>
      )}

      <RecentEntries entries={journalEntries.recentEntries} />

      {journalEntries.isLoading && <LoadingIndicator />}
    </Scene>
  );
}

const Panel = styled.div`
  max-width: 520px;
  margin-bottom: 8px;
`;

const StreakInfo = styled.div`
  color: ${s("textTertiary")};
  font-size: 13px;
  line-height: 1.5;
  margin: 8px 0 16px;
`;

export default observer(Journal);
