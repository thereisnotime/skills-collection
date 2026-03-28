import { useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Event handler type for Web Component custom events
 */
export type WebComponentEventHandler<T = unknown> = (event: CustomEvent<T>) => void;

/**
 * Maps event names to their handler functions
 */
export type EventHandlerMap = Record<string, WebComponentEventHandler>;

/**
 * Options for the useWebComponent hook
 */
export interface UseWebComponentOptions<P extends Record<string, unknown>> {
  /** The custom element tag name (e.g., 'loki-task-card') */
  tagName: string;
  /** Props to sync as attributes on the element */
  props: P;
  /** Event handlers to bind to the element */
  events?: EventHandlerMap;
  /** Whether to serialize complex values as JSON attributes (default: true) */
  serializeComplexValues?: boolean;
}

/**
 * Return type for the useWebComponent hook
 */
export interface UseWebComponentResult<E extends HTMLElement = HTMLElement> {
  /** Ref to attach to the web component element */
  ref: React.RefObject<E | null>;
  /** Manual method to update a single prop */
  updateProp: (key: string, value: unknown) => void;
  /** Manual method to dispatch a custom event to the element */
  dispatchEvent: <T>(eventName: string, detail?: T) => void;
}

/**
 * Converts a camelCase string to kebab-case for attribute names
 * Example: 'taskStatus' -> 'task-status'
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Determines if a value should be serialized as JSON
 */
function isComplexValue(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object'
  );
}

/**
 * Sets an attribute on an HTML element with proper type handling
 */
function setAttribute(
  element: HTMLElement,
  attrName: string,
  value: unknown,
  serializeComplex: boolean
): void {
  if (value === undefined || value === null) {
    element.removeAttribute(attrName);
    return;
  }

  if (typeof value === 'boolean') {
    // Boolean attributes: present = true, absent = false
    if (value) {
      element.setAttribute(attrName, '');
    } else {
      element.removeAttribute(attrName);
    }
    return;
  }

  if (typeof value === 'number') {
    element.setAttribute(attrName, String(value));
    return;
  }

  if (typeof value === 'string') {
    element.setAttribute(attrName, value);
    return;
  }

  // Complex values (objects, arrays)
  if (isComplexValue(value) && serializeComplex) {
    try {
      element.setAttribute(attrName, JSON.stringify(value));
    } catch {
      console.warn(
        `[useWebComponent] Failed to serialize value for attribute "${attrName}"`
      );
    }
    return;
  }

  // Fallback: convert to string
  element.setAttribute(attrName, String(value));
}

/**
 * Hook for integrating Web Components with React.
 *
 * Handles:
 * - Automatic prop-to-attribute syncing with type conversion
 * - Event listener binding and cleanup
 * - Complex object/array serialization as JSON attributes
 * - Proper cleanup on unmount
 *
 * @example
 * ```tsx
 * function TaskCard({ task, onStatusChange }: TaskCardProps) {
 *   const { ref } = useWebComponent<{ task: Task }>({
 *     tagName: 'loki-task-card',
 *     props: { task },
 *     events: {
 *       'status-change': createEventHandler<{ status: string }>((detail) => {
 *         onStatusChange(detail.status);
 *       }),
 *     },
 *   });
 *
 *   return <loki-task-card ref={ref} />;
 * }
 * ```
 */
export function useWebComponent<
  P extends Record<string, unknown>,
  E extends HTMLElement = HTMLElement
>({
  tagName: _tagName, // Reserved for future validation/debugging
  props,
  events = {},
  serializeComplexValues = true,
}: UseWebComponentOptions<P>): UseWebComponentResult<E> {
  // tagName is available for future element validation
  void _tagName;
  const ref = useRef<E | null>(null);

  // Track previous props to enable diffing
  const prevPropsRef = useRef<P | null>(null);

  // Sync props to attributes when they change
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const prevProps = prevPropsRef.current;

    // Set new/changed attributes
    Object.entries(props).forEach(([key, value]) => {
      // Skip if value hasn't changed (shallow comparison)
      if (prevProps && prevProps[key] === value) {
        return;
      }

      const attrName = toKebabCase(key);
      setAttribute(element, attrName, value, serializeComplexValues);
    });

    // Remove attributes for props that were removed
    if (prevProps) {
      Object.keys(prevProps).forEach((key) => {
        if (!(key in props)) {
          const attrName = toKebabCase(key);
          element.removeAttribute(attrName);
        }
      });
    }

    prevPropsRef.current = { ...props };
  }, [props, serializeComplexValues]);

  // Bind event listeners - use stable reference for cleanup
  const eventsRef = useRef<EventHandlerMap>(events);
  eventsRef.current = events;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Create wrapper handlers that call the current handler ref
    const boundHandlers: Array<{
      eventName: string;
      handler: EventListener;
    }> = [];

    Object.entries(eventsRef.current).forEach(([eventName]) => {
      const wrappedHandler: EventListener = (event) => {
        // Always use the current handler from ref
        const currentHandler = eventsRef.current[eventName];
        if (currentHandler) {
          currentHandler(event as CustomEvent);
        }
      };

      element.addEventListener(eventName, wrappedHandler);
      boundHandlers.push({ eventName, handler: wrappedHandler });
    });

    return () => {
      boundHandlers.forEach(({ eventName, handler }) => {
        element.removeEventListener(eventName, handler);
      });
    };
  }, [Object.keys(events).join(',')]); // Re-bind only when event names change

  // Manual prop update method
  const updateProp = useCallback(
    (key: string, value: unknown) => {
      const element = ref.current;
      if (!element) return;

      const attrName = toKebabCase(key);
      setAttribute(element, attrName, value, serializeComplexValues);
    },
    [serializeComplexValues]
  );

  // Dispatch custom event to the element
  const dispatchEvent = useCallback(<T,>(eventName: string, detail?: T) => {
    const element = ref.current;
    if (!element) return;

    const event = new CustomEvent(eventName, {
      detail,
      bubbles: true,
      composed: true,
    });
    element.dispatchEvent(event);
  }, []);

  // Memoize result to prevent unnecessary re-renders
  const result = useMemo(
    () => ({
      ref,
      updateProp,
      dispatchEvent,
    }),
    [updateProp, dispatchEvent]
  );

  return result;
}

/**
 * Helper to create typed event handlers for Web Component events.
 * Extracts the detail property from CustomEvent and passes it to your handler.
 *
 * @example
 * ```tsx
 * const handleStatusChange = createEventHandler<{ status: TaskStatus }>(
 *   ({ status }) => {
 *     console.log('New status:', status);
 *   }
 * );
 * ```
 */
export function createEventHandler<T = unknown>(
  handler: (detail: T) => void
): WebComponentEventHandler<T> {
  return (event: CustomEvent<T>) => {
    handler(event.detail);
  };
}

/**
 * Helper to create an event handler that receives the full CustomEvent.
 * Useful when you need access to event properties like target, currentTarget, etc.
 *
 * @example
 * ```tsx
 * const handleDragStart = createFullEventHandler<DragEventDetail>((event) => {
 *   console.log('Target:', event.target);
 *   console.log('Detail:', event.detail);
 * });
 * ```
 */
export function createFullEventHandler<T = unknown>(
  handler: (event: CustomEvent<T>) => void
): WebComponentEventHandler<T> {
  return handler;
}

/**
 * Type declarations for Web Components used in React JSX.
 * Add custom element interfaces to this declaration for proper typing.
 *
 * @example
 * ```tsx
 * // In a separate types file:
 * declare global {
 *   namespace JSX {
 *     interface IntrinsicElements {
 *       'loki-task-card': React.DetailedHTMLProps<
 *         React.HTMLAttributes<HTMLElement> & {
 *           task?: string;
 *           'show-actions'?: boolean;
 *         },
 *         HTMLElement
 *       >;
 *     }
 *   }
 * }
 * ```
 */

export default useWebComponent;
