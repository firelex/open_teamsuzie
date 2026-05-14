# @teamsuzie/pdf

DOCX → PDF via headless LibreOffice. Shells out to `soffice --headless --convert-to pdf`
with a disposable user profile per call.

## Install

On your dev box / server, install LibreOffice once:

```bash
brew install --cask libreoffice          # macOS
apt install libreoffice                  # Debian/Ubuntu
```

## Usage

```typescript
import { convertDocxBufferToPdf, isLibreOfficeAvailable } from '@teamsuzie/pdf';

if (!isLibreOfficeAvailable()) {
  throw new Error('LibreOffice is not installed; install it to enable PDF export.');
}
const pdfBytes = await convertDocxBufferToPdf(docxBytes);
```

## History

Lifted from `palisade-ai/apps/palisade/src/investigations/brief-pdf.ts` so the
PDF path can be reused across the PE agent suite and palisade. The original
palisade-ai copy will become a re-export.
