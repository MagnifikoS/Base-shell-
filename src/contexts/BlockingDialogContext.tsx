import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type BlockingDialogPayload = {
  title?: string;
  message: string;
};

type BlockingDialogContextValue = {
  showBlockingDialog: (payload: BlockingDialogPayload) => void;
};

const BlockingDialogContext = React.createContext<BlockingDialogContextValue | null>(null);

export function BlockingDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<BlockingDialogPayload | null>(null);

  const showBlockingDialog = React.useCallback((next: BlockingDialogPayload) => {
    setPayload(next);
    setOpen(true);
  }, []);

  const contextValue = React.useMemo<BlockingDialogContextValue>(
    () => ({ showBlockingDialog }),
    [showBlockingDialog]
  );

  return (
    <BlockingDialogContext.Provider value={contextValue}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setPayload(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{payload?.title ?? "Badge non valide"}</AlertDialogTitle>
            <AlertDialogDescription>{payload?.message ?? ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BlockingDialogContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBlockingDialog() {
  const ctx = React.useContext(BlockingDialogContext);
  if (!ctx) {
    throw new Error("useBlockingDialog must be used within BlockingDialogProvider");
  }
  return ctx;
}
