export async function fetchAllPages(fetcher,mapper,maxPages=50){
    const allItems = [];
    let pageToken = undefined;
    let page = 0;

    do{
        const response = await fetcher(pageToken);
        allItems.push(...mapper(response));
        pageToken = response.data?.nextPageToken;
        page++;
    } while(pageToken && page < maxPages);

    return allItems;
}

export function paginateYT(ytResponse, items) {
  const pi = ytResponse.data?.pageInfo ?? {};
  return {
    items,
    nextPageToken:  ytResponse.data?.nextPageToken  ?? null,
    prevPageToken:  ytResponse.data?.prevPageToken  ?? null,
    totalResults:   pi.totalResults   ?? items.length,
    resultsPerPage: pi.resultsPerPage ?? items.length,
  };
}