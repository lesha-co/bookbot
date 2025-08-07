export function sanitize(term: string) {
    const words = term
        .toLowerCase()
        .replace(/[^\sa-z0-9а-я.]/g, "")
        .split(" ")
        .filter((x) => x.length);

    return words;
}
