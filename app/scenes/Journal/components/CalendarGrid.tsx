import { BackIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import NudeButton from "~/components/NudeButton";

type Props = {
  year: number;
  month: number;
  dots: Set<string>;
  selectedDate: string;
  today: string;
  onSelectDate: (date: string) => void;
  onChangeMonth: (year: number, month: number) => void;
};

type CalendarCell = {
  day: number;
  date: string;
  hasEntry: boolean;
  isToday: boolean;
  isFuture: boolean;
};

/**
 * Renders an accessible month grid for Journal entries.
 *
 * @param props - calendar state and interaction callbacks.
 * @returns a calendar grid with month navigation.
 */
function CalendarGrid({
  year,
  month,
  dots,
  selectedDate,
  today,
  onSelectDate,
  onChangeMonth,
}: Props) {
  const { t } = useTranslation();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
  const cells: Array<CalendarCell | null> = [];

  for (let index = 0; index < offset; index++) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    cells.push({
      day,
      date,
      hasEntry: dots.has(date),
      isToday: date === today,
      isFuture: date > today,
    });
  }

  const handlePrevious = () => {
    if (month === 1) {
      onChangeMonth(year - 1, 12);
      return;
    }
    onChangeMonth(year, month - 1);
  };

  const handleNext = () => {
    if (month === 12) {
      onChangeMonth(year + 1, 1);
      return;
    }
    onChangeMonth(year, month + 1);
  };

  const monthLabel = new Date(year, month - 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <Wrapper aria-label={t("Journal calendar")}>
      <MonthNav>
        <NavButton
          type="button"
          onClick={handlePrevious}
          aria-label={t("Previous month")}
        >
          <BackIcon />
        </NavButton>
        <MonthLabel aria-live="polite">{monthLabel}</MonthLabel>
        <NextButton
          type="button"
          onClick={handleNext}
          aria-label={t("Next month")}
        >
          <BackIcon />
        </NextButton>
      </MonthNav>

      <WeekdayRow>
        {[t("Mo"), t("Tu"), t("We"), t("Th"), t("Fr"), t("Sa"), t("Su")].map(
          (weekday) => (
            <WeekdayHeader key={weekday}>{weekday}</WeekdayHeader>
          )
        )}
      </WeekdayRow>

      <DayGrid>
        {cells.map((cell, index) =>
          cell ? (
            <DayButton
              key={cell.date}
              type="button"
              disabled={cell.isFuture}
              aria-current={cell.isToday ? "date" : undefined}
              aria-pressed={cell.date === selectedDate}
              aria-label={
                cell.hasEntry
                  ? t("{{ date }}, has entry", { date: cell.date })
                  : cell.date
              }
              $isToday={cell.isToday}
              $hasEntry={cell.hasEntry}
              $isSelected={cell.date === selectedDate}
              onClick={() => onSelectDate(cell.date)}
            >
              <DayNumber>{cell.day}</DayNumber>
              {cell.hasEntry && <Dot aria-hidden="true" />}
            </DayButton>
          ) : (
            <EmptyCell key={`empty-${index}`} />
          )
        )}
      </DayGrid>
    </Wrapper>
  );
}

const Wrapper = styled.div`
  width: 100%;
`;

const MonthNav = styled.div`
  display: grid;
  grid-template-columns: 32px 1fr 32px;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
`;

const NavButton = styled(NudeButton)`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${s("textSecondary")};
`;

const NextButton = styled(NavButton)`
  transform: rotate(180deg);
`;

const MonthLabel = styled.span`
  color: ${s("text")};
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
`;

const WeekdayRow = styled.div`
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  margin-bottom: 6px;
`;

const WeekdayHeader = styled.span`
  color: ${s("textTertiary")};
  font-size: 12px;
  line-height: 24px;
  text-align: center;
`;

const DayGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
`;

const DayButton = styled.button<{
  $isToday: boolean;
  $hasEntry: boolean;
  $isSelected: boolean;
}>`
  position: relative;
  aspect-ratio: 1;
  min-width: 0;
  border: 0;
  border-radius: 6px;
  background: ${(props) => (props.$isSelected ? s("accent") : "transparent")};
  color: ${(props) =>
    props.$isSelected
      ? s("accentText")
      : props.$isToday
        ? s("accent")
        : s("text")};
  cursor: pointer;
  font-size: 14px;
  font-weight: ${(props) => (props.$isToday ? 600 : 400)};
  line-height: 1;

  &:hover:not(:disabled) {
    background: ${(props) =>
      props.$isSelected ? s("accent") : s("backgroundSecondary")};
  }

  &:disabled {
    cursor: default;
    opacity: 0.35;
  }
`;

const DayNumber = styled.span`
  display: block;
`;

const EmptyCell = styled.div`
  aspect-ratio: 1;
`;

const Dot = styled.span`
  position: absolute;
  left: 50%;
  bottom: 7px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  transform: translateX(-50%);
`;

export default CalendarGrid;
