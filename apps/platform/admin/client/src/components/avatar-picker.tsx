import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teamsuzie/ui';

const AVATAR_COUNTS = {
  female: 215,
  male: 214,
} as const;

type AvatarGender = keyof typeof AVATAR_COUNTS;

interface AvatarPickerProps {
  open: boolean;
  selected?: string;
  onClose: () => void;
  onSelect: (url: string | undefined) => void;
}

function avatarUrl(gender: AvatarGender, index: number): string {
  return `/avatars/${gender}/${index}.webp`;
}

export function AvatarPicker({ open, selected, onClose, onSelect }: AvatarPickerProps) {
  const [gender, setGender] = useState<AvatarGender>('female');
  const avatars = Array.from({ length: AVATAR_COUNTS[gender] }, (_, i) => avatarUrl(gender, i + 1));

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[82vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Choose avatar</DialogTitle>
          <DialogDescription>
            Pick one of the bundled agent portraits for this agent.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={gender}
          onValueChange={(value) => setGender(value as AvatarGender)}
          className="min-h-0 flex-1"
        >
          <div className="flex items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="female">Female</TabsTrigger>
              <TabsTrigger value="male">Male</TabsTrigger>
            </TabsList>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onSelect(undefined);
                onClose();
              }}
            >
              Clear
            </Button>
          </div>

          <TabsContent value={gender} className="mt-3 min-h-0 overflow-auto">
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
              {avatars.map((url) => (
                <button
                  key={url}
                  type="button"
                  className={`aspect-square overflow-hidden rounded-full border-2 transition-colors ${
                    selected === url
                      ? 'border-foreground'
                      : 'border-transparent hover:border-foreground/30'
                  }`}
                  onClick={() => {
                    onSelect(url);
                    onClose();
                  }}
                >
                  <img src={url} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
