import styled from "styled-components";
import Input from "~/components/Input";

/** A compact heading row for an independently saved setting. */
export const CustomizationSectionHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
`;

/** A noninteractive label for inheritance and publication state. */
export const CustomizationStatus = styled.span<{ $warning?: boolean }>`
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: ${(props) => props.theme.backgroundSecondary};
  color: ${(props) =>
    props.$warning ? props.theme.warning : props.theme.textSecondary};
`;

/** A wrapping action row that fits the narrowest settings layout. */
export const CustomizationActions = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
`;

/** An independently labelled field with consistent vertical spacing. */
export const CustomizationField = styled.div`
  margin: 20px 0;
  min-width: 0;
`;

/** A shared application input styled for editable source code. */
export const CustomizationCodeInput = styled(Input)`
  textarea {
    font-family: ${(props) => props.theme.fontFamilyMono};
    font-size: 13px;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    resize: vertical;
    min-width: 0;
    width: 100%;
    tab-size: 2;
  }
`;

/** Inline, accessible feedback for a failed customization save. */
export const CustomizationError = styled.p`
  color: ${(props) => props.theme.danger};
  margin: 12px 0;
  font-size: 13px;
  overflow-wrap: anywhere;
`;

/** Secondary text for saving, draft, and inherited-source explanations. */
export const CustomizationHelp = styled.p`
  color: ${(props) => props.theme.textSecondary};
  font-size: 13px;
  margin: 8px 0 12px;
  overflow-wrap: anywhere;
`;
