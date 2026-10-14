import { Parser, jaModel } from 'budoux';

// src/lib/lyrics/icuFolia/budouxJapanese.ts
// BudouX's Japanese parser on its own. engines.ts imports this module rather than `budoux` itself:
// a dynamic import of the package keeps its whole namespace (every language's model and the HTML
// processor, ~13 MB resident), while these static named imports let the bundler drop the rest.

export const createJapaneseParser = () => new Parser(jaModel);
