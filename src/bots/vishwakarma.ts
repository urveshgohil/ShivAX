import { SpecialistBot, providerCall } from './base.js';
import { adapter, providerContext } from './provider.js';
import { id, list, object, text } from './schema.js';
import { BotError } from '../agents/errors.js';
import type { CodeProvider } from './types.js';
import type { BotValue } from '../agents/types.js';

interface SourceFile {
    readonly path: string;
    readonly content: string;
    readonly language: string;
}
const content = { type: 'string', maxLength: 262_144 } as const;
const fileSchema = object({ path: id, content, language: id });
const filesSchema = { ...list(fileSchema, 32), minItems: 1 };
const patchSchema = object({ path: id, before: content, after: content });
function filesValid(files: readonly SourceFile[]): boolean {
    return (
        new Set(files.map((file) => file.path)).size === files.length &&
        files.every(
            (file) =>
                !/[\\:\x00-\x1f]/.test(file.path) &&
                file.path.split('/').every((part) => part !== '..' && part !== '.' && part !== '')
        )
    );
}
export class VishwakarmaBot extends SpecialistBot {
    constructor(model?: CodeProvider) {
        const provider = adapter(model, 'suggest');
        super('vishwakarma', {
            'code.summarize': {
                description:
                    'Report supplied source paths, languages, line counts and character counts.',
                input: object({ files: filesSchema }),
                output: object({
                    files: list(
                        object({
                            path: id,
                            language: id,
                            lines: { type: 'number' },
                            characters: { type: 'number' },
                        }),
                        32
                    ),
                    source: { enum: ['source-metadata'] },
                }),
                validate: (data) => filesValid((data as unknown as { files: SourceFile[] }).files),
                run: (data) => ({
                    files: (data as unknown as { files: SourceFile[] }).files.map((file) => ({
                        path: file.path,
                        language: file.language,
                        lines: file.content === '' ? 0 : file.content.split(/\r\n|\r|\n/).length,
                        characters: file.content.length,
                    })),
                    source: 'source-metadata',
                }),
            },
            'code.patch': {
                description:
                    'Prepare exact-match replacement artifacts from explicit edits; never applies them.',
                input: object({
                    files: filesSchema,
                    edits: {
                        ...list(object({ path: id, oldText: text, newText: content }), 32),
                        minItems: 1,
                    },
                }),
                output: object({
                    patches: list(patchSchema, 32),
                    applied: { enum: [false] },
                    source: { enum: ['explicit-replacements'] },
                }),
                validate: (data) => filesValid((data as unknown as { files: SourceFile[] }).files),
                run: (data) => {
                    const input = data as unknown as {
                        files: SourceFile[];
                        edits: { path: string; oldText: string; newText: string }[];
                    };
                    const seen = new Set<string>();
                    const patches = input.edits.map((edit) => {
                        const file = input.files.find((file) => file.path === edit.path);
                        if (
                            !file ||
                            seen.has(edit.path) ||
                            file.content.indexOf(edit.oldText) < 0 ||
                            file.content.indexOf(edit.oldText) !==
                                file.content.lastIndexOf(edit.oldText)
                        )
                            throw new BotError('invalid-input');
                        seen.add(edit.path);
                        return {
                            path: file.path,
                            before: file.content,
                            after: file.content.replace(edit.oldText, () => edit.newText),
                        };
                    });
                    return { patches, applied: false, source: 'explicit-replacements' };
                },
            },
            'code.suggest': {
                description: 'Return validated patch proposals from an injected provider.',
                input: object({ files: filesSchema, instruction: text }),
                output: object({
                    patches: list(patchSchema, 32),
                    explanation: text,
                    applied: { enum: [false] },
                    providerId: id,
                    source: { enum: ['code-provider'] },
                }),
                validate: (data) => filesValid((data as unknown as { files: SourceFile[] }).files),
                run: async (data, context) => {
                    const output = await providerCall(
                        provider
                            ? () => provider.suggest(data, providerContext(context))
                            : undefined,
                        context
                    );
                    const result = output as Readonly<Record<string, BotValue>>;
                    if (
                        !output ||
                        typeof output !== 'object' ||
                        Array.isArray(output) ||
                        Object.keys(output).sort().join(',') !== 'explanation,patches' ||
                        !Array.isArray(result.patches)
                    )
                        throw new BotError('invalid-output');
                    const files = (data as unknown as { files: SourceFile[] }).files,
                        seen = new Set();
                    for (const raw of result.patches) {
                        const patch = raw as Readonly<Record<string, BotValue>>;
                        if (
                            !patch ||
                            typeof patch !== 'object' ||
                            Array.isArray(patch) ||
                            seen.has(patch.path) ||
                            !files.some(
                                (file) => file.path === patch.path && file.content === patch.before
                            )
                        )
                            throw new BotError('invalid-output');
                        seen.add(patch.path);
                    }
                    return {
                        ...output,
                        applied: false,
                        providerId: provider!.id,
                        source: 'code-provider',
                    };
                },
            },
        });
    }
}
/** @deprecated Since 0.3.0. Use `VishwakarmaBot`. Instances report the bot id `'vishwakarma'`. */
export const VishwakarmBot = VishwakarmaBot;
/** @deprecated Since 0.3.0. Use `VishwakarmaBot`. */
export type VishwakarmBot = VishwakarmaBot;
