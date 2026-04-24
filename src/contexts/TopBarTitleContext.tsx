import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type TitleNode = React.ReactNode | null;

interface TopBarTitleContextValue {
  titleOverride: TitleNode;
  setTitleOverride: (node: TitleNode) => void;
}

const TopBarTitleContext = createContext<TopBarTitleContextValue>({
  titleOverride: null,
  setTitleOverride: () => {},
});

export const TopBarTitleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [titleOverride, setTitleOverrideState] = useState<TitleNode>(null);

  const setTitleOverride = useCallback((node: TitleNode) => {
    setTitleOverrideState(node);
  }, []);

  const value = useMemo(
    () => ({ titleOverride, setTitleOverride }),
    [titleOverride, setTitleOverride],
  );

  return <TopBarTitleContext.Provider value={value}>{children}</TopBarTitleContext.Provider>;
};

export const useTopBarTitleContext = () => useContext(TopBarTitleContext);

/**
 * Hook that lets a page push a custom node (string or ReactNode) into the
 * app top bar's title slot. The override is cleared automatically on unmount.
 *
 * Pass `null` (or omit the value via a falsy memo) to fall back to the
 * default title computed by the layout.
 */
export const useSetTopBarTitle = (node: TitleNode) => {
  const { setTitleOverride } = useContext(TopBarTitleContext);

  useEffect(() => {
    setTitleOverride(node);
    return () => setTitleOverride(null);
  }, [node, setTitleOverride]);
};

export default TopBarTitleContext;
