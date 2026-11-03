import * as React from "react";
import { type DialogProps } from "@radix-ui/react-dialog";
import { Search } from "lucide-react";

import { cn } from "@repo/ui/utils";
import { Dialog, DialogContent } from "@repo/ui/dialog";

// React 19 compatible Command — replaces cmdk to fix "Cannot read properties of undefined (reading 'startTime')" (scheduler / reportAllChanges)
type CommandContextType = {
  search: string;
  setSearch: (v: string) => void;
  registerValue: (v: string) => void;
  unregisterValue: (v: string) => void;
  hasMatches: boolean;
  shouldFilter: boolean;
};

const CommandContext = React.createContext<CommandContextType>({
  search: "",
  setSearch: () => {},
  registerValue: () => {},
  unregisterValue: () => {},
  hasMatches: true,
  shouldFilter: true,
});

type CommandProps = React.HTMLAttributes<HTMLDivElement> & {
  shouldFilter?: boolean;
};

const Command = React.forwardRef<HTMLDivElement, CommandProps>(({ className, children, shouldFilter = true, ...props }, ref) => {
  const [search, setSearch] = React.useState("");
  const [values, setValues] = React.useState<string[]>([]);

  const registerValue = React.useCallback((v: string) => {
    setValues(prev => (prev.includes(v) ? prev : [...prev, v]));
  }, []);
  const unregisterValue = React.useCallback((v: string) => {
    setValues(prev => prev.filter(x => x !== v));
  }, []);

  const hasMatches = React.useMemo(() => {
    if (values.length === 0) return false;
    if (!shouldFilter) return true;
    if (search.trim() === "") return true;
    const q = search.toLowerCase();
    return values.some(v => v.toLowerCase().includes(q));
  }, [search, values, shouldFilter]);

  return (
    <CommandContext.Provider value={{ search, setSearch, registerValue, unregisterValue, hasMatches, shouldFilter }}>
      <div
        ref={ref}
        className={cn(
          "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </CommandContext.Provider>
  );
});
Command.displayName = "Command";

interface CommandDialogProps extends DialogProps {}

const CommandDialog = ({ children, ...props }: CommandDialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

type CommandInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  onValueChange?: (value: string) => void;
};

const CommandInput = React.forwardRef<HTMLInputElement, CommandInputProps>(({ className, onValueChange, ...props }, ref) => {
  const { search, setSearch } = React.useContext(CommandContext);
  return (
    <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <input
        ref={ref}
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        value={search}
        onChange={e => {
          const v = e.target.value;
          setSearch(v);
          onValueChange?.(v);
          (props as any).onChange?.(e);
        }}
        {...props}
      />
    </div>
  );
});
CommandInput.displayName = "CommandInput";

const CommandList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)} {...props} />
));
CommandList.displayName = "CommandList";

const CommandEmpty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
  const { search, hasMatches } = React.useContext(CommandContext);
  if (search.trim() === "" || hasMatches) return null;
  return <div ref={ref} className={cn("py-6 text-center text-sm", (props as any).className)} {...props} />;
});
CommandEmpty.displayName = "CommandEmpty";

const CommandGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = "CommandGroup";

const CommandSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("-mx-1 h-px bg-border", className)} {...props} />
));
CommandSeparator.displayName = "CommandSeparator";

type CommandItemProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: string;
  onSelect?: (value: string) => void;
  disabled?: boolean;
};

const CommandItem = React.forwardRef<HTMLDivElement, CommandItemProps>(({ className, children, value, onSelect, disabled, onClick, ...props }, ref) => {
  const { search, registerValue, unregisterValue, shouldFilter } = React.useContext(CommandContext);
  const itemValue = value ?? (typeof children === "string" ? (children as string) : "");

  React.useEffect(() => {
    if (itemValue) {
      registerValue(itemValue);
      return () => unregisterValue(itemValue);
    }
  }, [itemValue, registerValue, unregisterValue]);

  if (shouldFilter) {
    const q = search.trim().toLowerCase();
    const matches = q === "" || itemValue.toLowerCase().includes(q) || (typeof children === "string" && (children as string).toLowerCase().includes(q));
    if (!matches) return null;
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    onSelect?.(itemValue);
    (onClick as any)?.(e);
  };

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        disabled && "pointer-events-none opacity-50",
        className
      )}
      onClick={handleClick}
      data-disabled={disabled ? "true" : undefined}
      {...props}
    >
      {children}
    </div>
  );
});
CommandItem.displayName = "CommandItem";

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props} />;
};
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
