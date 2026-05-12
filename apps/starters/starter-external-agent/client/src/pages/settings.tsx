import {
  AppShellContent,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DEFAULT_MODELS,
  ModelPicker,
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  useSelectedModel,
} from '@teamsuzie/ui';

const SELECTED_MODEL_KEY = 'starter-chat:selected-model';

export function SettingsPage({
  defaultModel,
}: {
  /** Server-configured default model — shown when the user hasn't picked one. */
  defaultModel?: string;
}) {
  const [selected, setSelected] = useSelectedModel(SELECTED_MODEL_KEY, defaultModel);

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Settings</PageHeaderTitle>
          <PageHeaderDescription>
            Preferences that apply to your chat sessions.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <AppShellContent className="px-6 pt-6 pb-12">
        <div className="grid max-w-3xl gap-4">
          <Card>
            <CardHeader>
              <CardDescription>Chat model</CardDescription>
              <CardTitle>Pick the model that powers your assistant</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-xs text-muted-foreground">
                Changes apply on the next message. Pricing values are approximate;
                follow the link beside each model to verify on the provider's
                pricing page.
              </p>
              <ModelPicker
                models={DEFAULT_MODELS}
                selected={selected}
                onSelect={setSelected}
              />
            </CardContent>
          </Card>
        </div>
      </AppShellContent>
    </>
  );
}
