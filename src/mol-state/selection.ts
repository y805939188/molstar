/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import { StateObject, StateObjectCell } from './object';
import { State } from './state';
import { StateTree } from './tree';
import { Transform } from './transform';

namespace StateSelection {
    export type Selector = Query | Builder | string | StateObjectCell;
    export type CellSeq = StateObjectCell[]
    export type Query = (state: State) => CellSeq;

    export function select(s: Selector, state: State) {
        return compile(s)(state);
    }

    export function compile(s: Selector): Query {
        const selector = s ? s : root();
        let query: Query;
        if (isBuilder(selector)) query = (selector as any).compile();
        else if (isObj(selector)) query = (byValue(selector) as any).compile();
        else if (isQuery(selector)) query = selector;
        else query = (byRef(selector as string) as any).compile();
        return query;
    }

    function isObj(arg: any): arg is StateObjectCell {
        return (arg as StateObjectCell).version !== void 0;
    }

    function isBuilder(arg: any): arg is Builder {
        return arg.compile !== void 0;
    }

    function isQuery(arg: any): arg is Query {
        return typeof arg === 'function';
    }

    export interface Builder {
        flatMap(f: (n: StateObjectCell) => StateObjectCell[]): Builder;
        mapEntity(f: (n: StateObjectCell) => StateObjectCell): Builder;
        unique(): Builder;

        parent(): Builder;
        first(): Builder;
        filter(p: (n: StateObjectCell) => boolean): Builder;
        withStatus(s: StateObjectCell.Status): Builder;
        subtree(): Builder;
        children(): Builder;
        ofType(t: StateObject.Type): Builder;
        ancestorOfType(t: StateObject.Type): Builder;

        select(state: State): CellSeq
    }

    const BuilderPrototype: any = {
        select(state: State) {
            return select(this, state);
        }
    };

    function registerModifier(name: string, f: Function) {
        BuilderPrototype[name] = function (this: any, ...args: any[]) { return f.call(void 0, this, ...args) };
    }

    function build(compile: () => Query): Builder {
        return Object.create(BuilderPrototype, { compile: { writable: false, configurable: false, value: compile } });
    }

    export function root() { return build(() => (state: State) => [state.cells.get(state.tree.root.ref)!]) }


    export function byRef(...refs: Transform.Ref[]) {
        return build(() => (state: State) => {
            const ret: StateObjectCell[] = [];
            for (const ref of refs) {
                const n = state.cells.get(ref);
                if (!n) continue;
                ret.push(n);
            }
            return ret;
        });
    }

    export function byValue(...objects: StateObjectCell[]) { return build(() => (state: State) => objects); }

    registerModifier('flatMap', flatMap);
    export function flatMap(b: Selector, f: (obj: StateObjectCell, state: State) => CellSeq) {
        const q = compile(b);
        return build(() => (state: State) => {
            const ret: StateObjectCell[] = [];
            for (const n of q(state)) {
                for (const m of f(n, state)) {
                    ret.push(m);
                }
            }
            return ret;
        });
    }

    registerModifier('mapEntity', mapEntity);
    export function mapEntity(b: Selector, f: (n: StateObjectCell, state: State) => StateObjectCell | undefined) {
        const q = compile(b);
        return build(() => (state: State) => {
            const ret: StateObjectCell[] = [];
            for (const n of q(state)) {
                const x = f(n, state);
                if (x) ret.push(x);
            }
            return ret;
        });
    }

    registerModifier('unique', unique);
    export function unique(b: Selector) {
        const q = compile(b);
        return build(() => (state: State) => {
            const set = new Set<string>();
            const ret: StateObjectCell[] = [];
            for (const n of q(state)) {
                if (!set.has(n.ref)) {
                    set.add(n.ref);
                    ret.push(n);
                }
            }
            return ret;
        })
    }

    registerModifier('first', first);
    export function first(b: Selector) {
        const q = compile(b);
        return build(() => (state: State) => {
            const r = q(state);
            return r.length ? [r[0]] : [];
        });
    }

    registerModifier('filter', filter);
    export function filter(b: Selector, p: (n: StateObjectCell) => boolean) { return flatMap(b, n => p(n) ? [n] : []); }

    registerModifier('withStatus', withStatus);
    export function withStatus(b: Selector, s: StateObjectCell.Status) { return filter(b, n => n.status === s); }

    registerModifier('subtree', subtree);
    export function subtree(b: Selector) {
        return flatMap(b, (n, s) => {
            const nodes = [] as string[];
            StateTree.doPreOrder(s.tree, s.tree.nodes.get(n.ref), nodes, (x, _, ctx) => { ctx.push(x.ref) });
            return nodes.map(x => s.cells.get(x)!);
        });
    }

    registerModifier('children', children);
    export function children(b: Selector) {
        return flatMap(b, (n, s) => {
            const nodes: StateObjectCell[] = [];
            s.tree.children.get(n.ref).forEach(c => nodes.push(s.cells.get(c!)!));
            return nodes;
        });
    }

    registerModifier('ofType', ofType);
    export function ofType(b: Selector, t: StateObject.Type) { return filter(b, n => n.obj ? n.obj.type === t : false); }

    registerModifier('ancestorOfType', ancestorOfType);
    export function ancestorOfType(b: Selector, types: StateObject.Ctor[]) { return unique(mapEntity(b, (n, s) => findAncestorOfType(s, n.ref, types))); }

    registerModifier('parent', parent);
    export function parent(b: Selector) { return unique(mapEntity(b, (n, s) => s.cells.get(s.tree.nodes.get(n.ref)!.parent))); }

    function findAncestorOfType({ tree, cells }: State, root: string, types: StateObject.Ctor[]): StateObjectCell | undefined {
        let current = tree.nodes.get(root)!, len = types.length;
        while (true) {
            current = tree.nodes.get(current.parent)!;
            if (current.ref === Transform.RootRef) {
                return cells.get(Transform.RootRef);
            }
            const obj = cells.get(current.ref)!.obj!;
            for (let i = 0; i < len; i++) {
                if (obj.type === types[i].type) return cells.get(current.ref);
            }
        }
    }
}

export { StateSelection }