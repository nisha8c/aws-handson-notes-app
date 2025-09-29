// src/App.tsx
import * as React from "react";
import { useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import { generateClient } from "aws-amplify/data";
import { uploadData, getUrl } from "aws-amplify/storage";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

// Import your Gen 2 schema types
import type { Schema } from "../amplify/data/resource";

Amplify.configure(outputs);

// Strongly-typed data client based on your schema
const client = generateClient<Schema>();

// The entity type from your schema
type Todo = Schema["Todo"]["type"];
type WithImageUrl<T> = T & { imageUrl?: string };

// For UI rendering we expect common fields:
type NoteView = Todo & {
    id: string;
    title: string;
    content?: string;
};

// ---------- tiny typed helpers (no `any`) ----------
function readStringProp<T extends object>(obj: T, key: string): string | undefined {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

/** Try to detect the image storage key field on your model. */
function getImageKey(note: Partial<Todo>): string | undefined {
    return readStringProp(note, "imageKey") ?? readStringProp(note, "image");
}

/** Build the create payload, attaching whichever image field your model has. */
function buildCreateInput(
    base: { title: string; content?: string },
    imageKey?: string
): Partial<Todo> {
    const payload: Record<string, unknown> = { ...base };
    if (imageKey) {
        // Prefer imageKey if present in the type at runtime, else try image.
        // (Setting a non-existent field is ignored at type level after the cast.)
        payload.imageKey = imageKey;
        payload.image = imageKey;
    }
    return payload as Partial<Todo>;
}

export default function App() {
    const [notes, setNotes] = useState<Array<WithImageUrl<NoteView>>>([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<{
        title: string;
        content?: string;
        imageFile: File | null;
    }>({
        title: "",
        content: "",
        imageFile: null,
    });

    useEffect(() => {
        void fetchNotes();
    }, []); // run once

    // ------- fetchNotes -------
    async function fetchNotes() {
        setLoading(true);
        try {
            const { data, errors } = await client.models.Todo.list();
            if (errors?.length) console.error("List errors:", errors);

            const enriched = await Promise.all(
                (data ?? []).map(async (n) => {
                    const key = getImageKey(n);
                    if (key) {
                        try {
                            // ✅ New Storage signature uses `path` (key is deprecated)
                            const { url } = await getUrl({ path: key });
                            return { ...(n as NoteView), imageUrl: url?.toString() };
                        } catch {
                            // If URL resolution fails, fall back to the item itself
                            return n as NoteView;
                        }
                    }
                    return n as NoteView;
                })
            );

            setNotes(enriched);
        } finally {
            setLoading(false);
        }
    }

    // ------- createNote -------
    async function createNote(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const title = form.title?.trim();
        if (!title) return;

        const base = { title, content: form.content?.trim() || undefined };

        // Optional image upload
        let imagePath: string | undefined;
        if (form.imageFile) {
            // ✅ Use `path` instead of deprecated `key`
            imagePath = `public/notes/${Date.now()}_${form.imageFile.name}`;
            await uploadData({
                path: imagePath,
                data: form.imageFile,
                options: { contentType: form.imageFile.type },
            }).result;
        }

        const input = buildCreateInput(base, imagePath);

        const { data: created, errors } = await client.models.Todo.create(input);
        if (errors?.length) console.error("Create errors:", errors);

        // Add to local state (resolve image URL if present)
        let newItem = created as WithImageUrl<NoteView>;
        const key = getImageKey(created as Partial<Todo>);
        if (key) {
            try {
                const { url } = await getUrl({ path: key });
                newItem = { ...(created as NoteView), imageUrl: url?.toString() };
            } catch {
                // ignore
            }
        }

        setNotes((prev) => [newItem, ...prev]);
        setForm({ title: "", content: "", imageFile: null });
        (e.target as HTMLFormElement).reset();
    }

    // ------- deleteNote -------
    async function deleteNote(id: string) {
        await client.models.Todo.delete({ id });
        setNotes((prev) => prev.filter((n) => n.id !== id));
    }

    return (
        <Authenticator>
            {({ user, signOut }) => (
                <main className="max-w-3xl mx-auto p-6 space-y-6">
                    <header className="flex items-center justify-between">
                        <h1 className="text-2xl font-semibold">Notes App</h1>
                        <div className="text-sm flex items-center gap-3">
                            <span>Signed in as {user?.username}</span>
                            <button
                                className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
                                onClick={signOut}
                            >
                                Sign out
                            </button>
                        </div>
                    </header>

                    <section className="p-4 rounded-xl border">
                        <h2 className="font-medium mb-3">Create a note</h2>
                        <form onSubmit={createNote} className="space-y-3">
                            <input
                                className="w-full rounded border p-2"
                                placeholder="Title"
                                value={form.title}
                                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                                required
                            />
                            <textarea
                                className="w-full rounded border p-2"
                                placeholder="Content (optional)"
                                rows={3}
                                value={form.content}
                                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                            />
                            <input
                                type="file"
                                accept="image/*"
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, imageFile: e.target.files?.[0] ?? null }))
                                }
                            />
                            <button
                                type="submit"
                                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                            >
                                Save note
                            </button>
                        </form>
                    </section>

                    <section className="space-y-2">
                        <div className="flex items-center gap-3">
                            <h2 className="font-medium">Your notes</h2>
                            <button
                                onClick={fetchNotes}
                                className="px-3 py-1 rounded border hover:bg-gray-50"
                                disabled={loading}
                                title="Refresh"
                            >
                                {loading ? "Refreshing..." : "Refresh"}
                            </button>
                        </div>

                        {notes.length === 0 && !loading && (
                            <p className="text-gray-600">No notes yet — add one above.</p>
                        )}

                        <ul className="grid gap-4">
                            {notes.map((note) => (
                                <li key={note.id} className="p-4 rounded-xl border flex gap-4 items-start">
                                    {note.imageUrl ? (
                                        <img
                                            src={note.imageUrl}
                                            alt={note.title}
                                            className="w-24 h-24 object-cover rounded-lg border"
                                        />
                                    ) : (
                                        <div className="w-24 h-24 rounded-lg border grid place-items-center text-xs text-gray-500">
                                            No image
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <h3 className="font-semibold">{note.title}</h3>
                                        {!!note.content && (
                                            <p className="text-gray-700 mt-1 whitespace-pre-wrap">{note.content}</p>
                                        )}
                                        <button
                                            onClick={() => deleteNote(note.id)}
                                            className="mt-3 px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                </main>
            )}
        </Authenticator>
    );
}
