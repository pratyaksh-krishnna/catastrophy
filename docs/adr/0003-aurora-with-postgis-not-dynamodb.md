# Aurora Serverless v2 with PostGIS, not DynamoDB

Catastrophy is built for an AWS hackathon, so the datastore had to be AWS-native. We chose Aurora Serverless v2 PostgreSQL with the PostGIS extension over DynamoDB, which was the first instinct.

Nearly every core operation is geospatial: deduplicating Buildings by proximity, aggregating reported Buildings into heatmap cells that merge upward until each holds at least five, and checking a submitted device location against the claimed Building. PostGIS answers these in single queries. DynamoDB would actually serve the heatmap well, since geohash prefixes are naturally hierarchical and "merge upward" is prefix truncation, but proximity dedupe degrades into fetching nine neighbouring cells and haversine-filtering in application code, and every new analytical question needs another denormalised index built by hand.

Aurora satisfies the AWS constraint at no cost to the model. S3, Amazon Location Service, SES and Lambda carry the rest of the AWS surface.

## Consequences

- Aurora Serverless v2 scaling down to minimum capacity adds resume latency on the first query after idle. Warm it before a live demo rather than discovering this on stage.
- Choosing Postgres does not weaken the AWS story. If a future constraint genuinely requires DynamoDB, the heatmap ports cleanly and the dedupe is the piece that must be rewritten.
