import { scene } from './visual-matching.mjs';

// Expected pairs are specified before changing the matcher. Extra wrappers and
// newly introduced controls have no expected counterpart.
const fixture = (name, reference, target, ids) => ({ name,
    reference: scene('r-', reference), target: scene('t-', target),
    expected: ids.map(id => [`r-${id}`, `t-${id}`]),
});
const base = [['root', 'main', ''], ['title', 'heading', 'Account settings', 'root'],
    ['billing', 'heading', 'Billing', 'root']];
const controls = [['root', 'main', ''], ['save', 'button', 'Save settings', 'root']];
export const reviewCorpus = [
    fixture('moved Cancel must not match new Archive', [...base, ['cancel', 'button', 'Cancel', 'root']],
        [...base, ['actions', 'group', 'Actions', 'root'], ['cancel', 'button', 'Cancel', 'actions'],
            ['archive', 'button', 'Archive', 'root']], ['root', 'title', 'billing', 'cancel']),
    fixture('identical control-only page', controls, controls, ['root', 'save']),
    fixture('group versus neutral wrapper retains descendant identity',
        [['root', 'main', ''], ['title', 'heading', 'Settings', 'root'], ['wrap', 'group', '', 'root'],
            ['a', 'heading', 'Privacy', 'wrap'], ['b', 'button', 'Edit', 'wrap']],
        [['root', 'main', ''], ['title', 'heading', 'Settings', 'root'], ['wrap', 'generic', '', 'root'],
            ['a', 'heading', 'Privacy', 'wrap'], ['b', 'button', 'Edit', 'wrap']], ['root', 'title', 'a', 'b']),
    fixture('copy changed throughout a stable unique page structure',
        [['root', 'main', ''], ['head', 'heading', 'Welcome', 'root'], ['text', 'paragraph', 'Original body', 'root']],
        [['root', 'main', ''], ['head', 'heading', 'Greetings', 'root'], ['text', 'paragraph', 'Revised description', 'root']],
        ['root', 'head', 'text']),
];
