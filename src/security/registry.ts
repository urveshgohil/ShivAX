import { array, identifier, record } from '../agents/validation.js';
import { SecurityError, securityError } from './errors.js';
import type { BotValue } from '../agents/types.js';
import type { PermissionPolicy, ProtectedTool, SecurityActionKind } from './types.js';

/** Host-owned mutable configuration; only frozen snapshots are handed to authorization code. */
export class PermissionPolicyRegistry {
    readonly #policies = new Map<string, PermissionPolicy>();
    register(policy: PermissionPolicy): this {
        let snapshot: PermissionPolicy;
        try {
            const value = record(
                policy,
                ['kind', 'id', 'permissions', 'effect', 'requiresApproval', 'validateInput'],
                'invalid-input'
            );
            identifier(value.id, 'invalid-input');
            if (
                !['capability', 'tool'].includes(value.kind as string) ||
                !['read-only', 'state-changing'].includes(value.effect as string) ||
                (value.requiresApproval !== undefined &&
                    typeof value.requiresApproval !== 'boolean') ||
                typeof value.validateInput !== 'function'
            )
                throw new SecurityError('invalid-policy');
            const permissions = array(value.permissions, 128, 'invalid-input').map((item) => {
                identifier(item, 'invalid-input');
                return item;
            });
            if (!permissions.length || new Set(permissions).size !== permissions.length)
                throw new SecurityError('invalid-policy');
            snapshot = Object.freeze({
                kind: policy.kind,
                id: policy.id,
                permissions: Object.freeze(permissions),
                effect: policy.effect,
                requiresApproval:
                    policy.effect === 'state-changing' || policy.requiresApproval === true,
                validateInput: policy.validateInput.bind(policy),
            });
        } catch (error) {
            throw securityError(error, 'invalid-policy');
        }
        const key = JSON.stringify([snapshot.kind, snapshot.id]);
        if (this.#policies.has(key)) throw new SecurityError('duplicate-policy');
        this.#policies.set(key, snapshot);
        return this;
    }
    get(kind: SecurityActionKind, id: string): PermissionPolicy | undefined {
        return this.#policies.get(JSON.stringify([kind, id]));
    }
    unregister(kind: SecurityActionKind, id: string): boolean {
        return this.#policies.delete(JSON.stringify([kind, id]));
    }
    list(): readonly PermissionPolicy[] {
        return Object.freeze([...this.#policies.values()]);
    }
}

/** No built-in shell, filesystem or network handlers. Host injects narrow services explicitly. */
export class ProtectedToolRegistry {
    readonly #tools = new Map<string, ProtectedTool>();
    register<I extends BotValue, O extends BotValue>(tool: ProtectedTool<I, O>): this {
        try {
            const value = record(
                tool,
                ['id', 'validateInput', 'validateOutput', 'execute'],
                'invalid-input'
            );
            identifier(value.id, 'invalid-input');
            if (
                typeof value.validateInput !== 'function' ||
                typeof value.validateOutput !== 'function' ||
                typeof value.execute !== 'function'
            )
                throw new SecurityError('invalid-tool');
            if (this.#tools.has(tool.id)) throw new SecurityError('duplicate-tool');
            this.#tools.set(
                tool.id,
                Object.freeze({
                    id: tool.id,
                    validateInput: tool.validateInput.bind(tool),
                    validateOutput: tool.validateOutput.bind(tool),
                    execute: tool.execute.bind(tool),
                })
            );
            return this;
        } catch (error) {
            throw securityError(error, 'invalid-tool');
        }
    }
    get(id: string): ProtectedTool | undefined {
        return this.#tools.get(id);
    }
    unregister(id: string): boolean {
        return this.#tools.delete(id);
    }
}
