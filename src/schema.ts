import z from "zod";

export const BookSchema = z.object({
    lib_id: z.number(),
    book_title: z.string(),
    book_author: z.string(),
    book_genre: z.string(),
    book_language: z.string(),
    file_name: z.string(),
    file_size: z.number(),
    file_location: z.string(),
});
export type BookSchema = z.infer<typeof BookSchema>;
