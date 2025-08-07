import z from "zod";

export const BookSchema = z.object({
    lib_id: z.number(),
    book_title: z.string(),
    book_author: z.string(),
    book_genre: z.string().nullable(),
    book_language: z.string().nullable(),
    file_name: z.string(),
    file_size: z.number(),
    file_location: z.string(),
});
export type BookSchema = z.infer<typeof BookSchema>;
