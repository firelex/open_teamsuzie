import {
  PageShell,
  PageBody,
  FileText,
  Card,
  CardContent,
  MarkdownView,
} from '@teamsuzie/ui';

const SAMPLE_BODY = `# Sample artifact

This panel demonstrates \`MarkdownView\` from \`@teamsuzie/ui\`.

- Switch between **Rendered** and **Raw** with the toggle in the header.
- Fenced code blocks render with the shared prose styles.
- Mermaid blocks render via the lazy-loaded \`MermaidBlock\` (try the diagram below).

\`\`\`mermaid
flowchart LR
  Input --> Validate --> Plan --> Execute --> Output
  Plan -->|needs review| Approval
\`\`\`

Replace this body with your real artifact source.
`;

/**
 * Artifact viewer placeholder. The brief calls out a "basic
 * artifact/document area" and the IT department's pattern (Specs, Plans,
 * Tickets, Docs) uses `MarkdownView` for every one — so the starter
 * leads with the same viewer.
 */
export function ArtifactsPage() {
  return (
    <PageShell
      icon={FileText}
      kicker="Documents"
      title="Artifacts"
      tagline="Generated outputs, attached references, and saved drafts."
      reserveUsageArea={false}
      watermarkSrc={null}
      bodyScrolls={false}
    >
      <PageBody className="h-full">
        <Card className="h-full">
          <CardContent className="h-full">
            <MarkdownView body={SAMPLE_BODY} className="h-full" />
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}
