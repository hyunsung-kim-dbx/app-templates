import { type ComponentProps, memo } from 'react';
import { DatabricksMessageCitationStreamdownIntegration } from '../databricks-message-citation';
import { Streamdown } from 'streamdown';
import { CollapsibleHtmlTable } from '../collapsible-html-table';

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  (props: ResponseProps) => {
    return (
      <Streamdown
        components={{
          a: DatabricksMessageCitationStreamdownIntegration,
          table: CollapsibleHtmlTable,
        }}
        className="flex flex-col gap-4"
        {...props}
      />
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = 'Response';
