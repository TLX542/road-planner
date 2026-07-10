"use client";

import { useEffect, useRef, useState } from "react";

type Suggestion = {
  id: string;
  label: string;
};

type AddressAutocompleteProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 350;

/**
 * Free-text address input with place suggestions from OpenStreetMap's
 * Nominatim search API. No API key required. Swap the `fetchSuggestions`
 * call for Google Places / Mapbox if you need higher volume or better
 * relevance in production.
 */
export function AddressAutocomplete({ id, value, onChange, placeholder, disabled }: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const skipNextFetch = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Mirrors focus state in a ref (not just state) so the async fetch
  // callback below can check "is the user still in this field right now"
  // at the moment results come back, not at the moment the request was
  // fired. This is what stops suggestions from popping open when `value`
  // changes for reasons other than typing — e.g. this field getting
  // remounted with a pre-filled address when the user switches days.
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }

    // Only look up suggestions while the user is actually in this field.
    // Without this, switching days (which remounts the field with a new
    // starting value) would trigger a lookup and pop the dropdown open on
    // a field the user isn't even touching.
    if (!isFocusedRef.current) {
      return;
    }

    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          format: "json",
          addressdetails: "0",
          limit: "6",
          q: query,
        });

        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error("Lookup failed");
        }

        const data = (await response.json()) as Array<{ place_id: number; display_name: string }>;

        if (!isFocusedRef.current) {
          // User left the field while the request was in flight — don't
          // pop the list open on a field they're no longer in.
          setLoading(false);
          return;
        }

        setSuggestions(data.map((item) => ({ id: String(item.place_id), label: item.display_name })));
        setOpen(true);
        setHighlighted(-1);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectSuggestion = (suggestion: Suggestion) => {
    skipNextFetch.current = true;
    onChange(suggestion.label);
    setSuggestions([]);
    setOpen(false);
    setHighlighted(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter" && highlighted >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[highlighted]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="autocompleteField" ref={containerRef}>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          isFocusedRef.current = true;
          // Re-show existing results (if any) when refocusing rather than
          // re-fetching — the fetch effect only runs on genuine typing.
          if (suggestions.length > 0) {
            setOpen(true);
          }
        }}
        onBlur={() => {
          isFocusedRef.current = false;
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (loading || suggestions.length > 0) ? (
        <ul className="autocompleteList" role="listbox">
          {loading ? <li className="autocompleteStatus">Searching…</li> : null}
          {!loading && suggestions.length === 0 ? (
            <li className="autocompleteStatus">No matches</li>
          ) : (
            suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                role="option"
                aria-selected={index === highlighted}
                className={`autocompleteOption${index === highlighted ? " highlighted" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectSuggestion(suggestion);
                }}
                onMouseEnter={() => setHighlighted(index)}
              >
                {suggestion.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}