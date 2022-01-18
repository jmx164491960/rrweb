import { elementNode, INode, NodeType } from 'rrweb-snapshot';
import type { Mirror } from 'rrweb/src/types';
import {
  RRCDATASection,
  RRComment,
  RRElement,
  RRStyleElement,
  RRNode,
  RRText,
  VirtualStyleRules,
  StyleRuleType,
} from './document-browser';

export function diff(oldTree: INode, newTree: RRNode, mirror: Mirror) {
  switch (newTree.nodeType) {
    case NodeType.Element:
      diffProps((oldTree as unknown) as HTMLElement, newTree as RRElement);
      if (
        oldTree instanceof HTMLStyleElement &&
        newTree instanceof RRStyleElement
      )
        applyVirtualStyleRulesToNode(oldTree, newTree.rules);
      break;
    // TODO: Diff other kinds of nodes.
    default:
  }
  const oldChildren = oldTree.childNodes;
  const newChildren = newTree.childNodes;
  if (oldChildren.length > 0 || newChildren.length > 0) {
    diffChildren(
      (Array.from(oldChildren) as unknown) as INode[],
      newChildren,
      oldTree,
      mirror,
    );
  }
}

function diffProps(oldTree: HTMLElement, newTree: RRElement) {
  const oldAttributes = oldTree.attributes;
  const newAttributes = newTree.attributes;

  for (const { name, value } of Array.from(oldAttributes)) {
    if (!(name in newAttributes)) oldTree.removeAttribute(name);
    const newValue = newAttributes[name];
    if (value === newValue) continue;
    else oldTree.setAttribute(name, newValue as string);
  }

  for (let attribute in newAttributes) {
    const newValue = newAttributes[attribute];
    if (oldAttributes.hasOwnProperty(attribute)) continue;
    if (typeof newValue === 'boolean' || typeof newValue === 'number') {
      // TODO Some special cases for some kinds of elements. e.g. checked, rr_scrollLeft
    } else {
      if ((newTree.__sn as elementNode).isSVG && attribute === 'xlink:href')
        oldTree.setAttributeNS(
          'http://www.w3.org/1999/xlink',
          attribute,
          newValue,
        );
      else oldTree.setAttribute(attribute, newValue);
    }
  }
}

function diffChildren(
  oldChildren: (INode | undefined)[],
  newChildren: RRNode[],
  parentNode: INode,
  mirror: Mirror,
) {
  let oldStartIndex = 0,
    oldEndIndex = oldChildren.length - 1,
    newStartIndex = 0,
    newEndIndex = newChildren.length - 1;
  let oldStartNode = oldChildren[oldStartIndex],
    oldEndNode = oldChildren[oldEndIndex],
    newStartNode = newChildren[newStartIndex],
    newEndNode = newChildren[newEndIndex];
  let oldIdToIndex: Record<number, number> | undefined = undefined,
    indexInOld;
  while (oldStartIndex <= oldEndIndex && newStartIndex <= newEndIndex) {
    if (oldStartNode === undefined) {
      oldStartNode = oldChildren[++oldStartIndex];
    } else if (oldEndNode === undefined) {
      oldEndNode = oldChildren[--oldEndIndex];
    } else if (oldStartNode.__sn?.id === newStartNode.__sn.id) {
      diff(oldStartNode, newStartNode, mirror);
      oldStartNode = oldChildren[++oldStartIndex];
      newStartNode = newChildren[++newStartIndex];
    } else if (oldEndNode.__sn?.id === newEndNode.__sn.id) {
      diff(oldEndNode, newEndNode, mirror);
      oldEndNode = oldChildren[--oldEndIndex];
      newEndNode = newChildren[--newEndIndex];
    } else if (oldStartNode.__sn?.id === newEndNode.__sn.id) {
      parentNode.insertBefore(oldStartNode, oldEndNode.nextSibling);
      diff(oldStartNode, newEndNode, mirror);
      oldStartNode = oldChildren[++oldStartIndex];
      newEndNode = newChildren[--newEndIndex];
    } else if (oldEndNode.__sn?.id === newStartNode.__sn.id) {
      parentNode.insertBefore(oldEndNode, oldStartNode);
      diff(oldEndNode, newStartNode, mirror);
      oldEndNode = oldChildren[--oldEndIndex];
      newStartNode = newChildren[++newStartIndex];
    } else {
      if (!oldIdToIndex) {
        oldIdToIndex = {};
        for (let i = oldStartIndex; i <= oldEndIndex; i++) {
          const oldChild = oldChildren[i];
          if (oldChild?.__sn) oldIdToIndex[oldChild.__sn.id] = i;
        }
      }
      indexInOld = oldIdToIndex[newStartNode.__sn.id];
      if (indexInOld) {
        const nodeToMove = oldChildren[indexInOld]!;
        parentNode.insertBefore(nodeToMove, oldStartNode);
        diff(nodeToMove, newStartNode, mirror);
        oldChildren[indexInOld] = undefined;
      } else {
        const newNode = createOrGetNode(newStartNode, mirror);
        parentNode.insertBefore(newNode, oldStartNode);
        diff(newNode, newStartNode, mirror);
      }
      newStartNode = newChildren[++newStartIndex];
    }
  }
  if (oldStartIndex > oldEndIndex) {
    const referenceRRNode = newChildren[newEndIndex + 1];
    let referenceNode = null;
    if (referenceRRNode)
      parentNode.childNodes.forEach((child) => {
        if (((child as unknown) as INode).__sn.id === referenceRRNode.__sn.id)
          referenceNode = child;
      });
    for (; newStartIndex <= newEndIndex; ++newStartIndex) {
      const newNode = createOrGetNode(newChildren[newStartIndex], mirror);
      parentNode.insertBefore(newNode, referenceNode);
      diff(newNode, newChildren[newStartIndex], mirror);
    }
  } else if (newStartIndex > newEndIndex) {
    for (; oldStartIndex <= oldEndIndex; oldStartIndex++) {
      const node = oldChildren[oldStartIndex];
      if (node) {
        parentNode.removeChild(node);
        mirror.removeNodeFromMap(node);
      }
    }
  }
}

export function createOrGetNode(rrNode: RRNode, mirror: Mirror): INode {
  let node = mirror.getNode(rrNode.__sn.id);
  if (node !== null) return node;
  if (rrNode instanceof RRElement) {
    if ((rrNode.__sn as elementNode).isSVG)
      node = (document.createElementNS(
        'http://www.w3.org/2000/svg',
        rrNode.tagName.toLowerCase(),
      ) as unknown) as INode;
    else node = (document.createElement(rrNode.tagName) as unknown) as INode;
  } else if (rrNode instanceof RRText) {
    node = (document.createTextNode(rrNode.textContent) as unknown) as INode;
  } else if (rrNode instanceof RRComment) {
    node = (document.createComment(rrNode.data) as unknown) as INode;
  } else if (rrNode instanceof RRCDATASection) {
    node = (document.createCDATASection(rrNode.data) as unknown) as INode;
  } else throw new Error('Unknown rrNode type ' + rrNode.toString());
  node.__sn = { ...rrNode.__sn };
  mirror.map[rrNode.__sn.id] = node;
  return node;
}

export function getNestedRule(
  rules: CSSRuleList,
  position: number[],
): CSSGroupingRule {
  const rule = rules[position[0]] as CSSGroupingRule;
  if (position.length === 1) {
    return rule;
  } else {
    return getNestedRule(
      ((rule as CSSGroupingRule).cssRules[position[1]] as CSSGroupingRule)
        .cssRules,
      position.slice(2),
    );
  }
}

export function getPositionsAndIndex(nestedIndex: number[]) {
  const positions = [...nestedIndex];
  const index = positions.pop();
  return { positions, index };
}

export function applyVirtualStyleRulesToNode(
  styleNode: HTMLStyleElement,
  virtualStyleRules: VirtualStyleRules,
) {
  const sheet = styleNode.sheet!;

  virtualStyleRules.forEach((rule) => {
    if (rule.type === StyleRuleType.Insert) {
      try {
        if (Array.isArray(rule.index)) {
          const { positions, index } = getPositionsAndIndex(rule.index);
          const nestedRule = getNestedRule(sheet.cssRules, positions);
          nestedRule.insertRule(rule.cssText, index);
        } else {
          sheet.insertRule(rule.cssText, rule.index);
        }
      } catch (e) {
        /**
         * sometimes we may capture rules with browser prefix
         * insert rule with prefixs in other browsers may cause Error
         */
      }
    } else if (rule.type === StyleRuleType.Remove) {
      try {
        if (Array.isArray(rule.index)) {
          const { positions, index } = getPositionsAndIndex(rule.index);
          const nestedRule = getNestedRule(sheet.cssRules, positions);
          nestedRule.deleteRule(index || 0);
        } else {
          sheet.deleteRule(rule.index);
        }
      } catch (e) {
        /**
         * accessing styleSheet rules may cause SecurityError
         * for specific access control settings
         */
      }
    } else if (rule.type === StyleRuleType.SetProperty) {
      const nativeRule = (getNestedRule(
        sheet.cssRules,
        rule.index,
      ) as unknown) as CSSStyleRule;
      nativeRule.style.setProperty(rule.property, rule.value, rule.priority);
    } else if (rule.type === StyleRuleType.RemoveProperty) {
      const nativeRule = (getNestedRule(
        sheet.cssRules,
        rule.index,
      ) as unknown) as CSSStyleRule;
      nativeRule.style.removeProperty(rule.property);
    }
  });
}