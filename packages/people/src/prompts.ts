import { fill, promptLoader } from '@teamsuzie/prompt-files';

/** The prompt files under prompts/ (Jeff Desk's, word for word; see @teamsuzie/prompt-files for the rules). */
export const prompt = promptLoader(new URL('./prompts/', import.meta.url));
export { fill };
