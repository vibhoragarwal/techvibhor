---
title: "AWS Athena - Partitioning tips when building Data Lake with Tabular numeric data"
excerpt: "When dealing with tabular data spread, how do you partition data for optimal cost-optimized, fast and scalable
querying ?"
coverImage: "/assets/blog/aws-athena/aws-athena.png"
date: "2024-09-01T15:35:07.322Z"
author:
  name: Vibhor Agarwal
  picture: "/assets/blog/authors/techvibhor.png"
ogImage:
  url: "/assets/blog/aws-athena/aws-athena.png"

---


## Summary 

This blog describes some key aspects & learnings from experience working with AWS Athena.
Some learnings are on top of best practices, and deal with tabular data processing use case specifically.


Read AWS documentation for details on how this service works, and come back here ! 



## Performance tuning tips 

[AWS Athena Performance Tuning Tips](https://aws.amazon.com/blogs/big-data/top-10-performance-tuning-tips-for-amazon-athena/)


## Partitioning data

Basic premise that Athena works efficiently on is to limit the size of data to scan, to read desired results.

When the query conditions are known, instead of querying a large file in GBs, partition it, to direct your queries to query on smaller file sets and be faster.

Hive partitions are supported in S3 and can be used to partition data with a partition key as a query parameter and value as a data field that seems fit.

Now partitioning depends on use case itself, and mandatory attributes in your query to Athena which can decide partition keys.


## Raw data format to be partitioned

Assume this is the data format, where for each key element, and for millions of combinations of "attr1_*" input data, 
"out_*" output was created and persisted in AWS S3 in zipped files, with hundreds of GBs of data points.

Now for querying, we assume that "attr1..", "attr2..", "attr3.. are always provided in the query, while "attr4.."
and "attr5.." are optionally provided. "attr5_str" is another input element, which does not come in query, but is a filter
in 'where' clause of the query; same with 'out_key1' & 'out_key2' which may or may not be part of where clause.


 | attr0_str     | attr1_num | attr2_num | attr3_num | attr4_num | attr5_str | out_key1     | out_key2   | 
 |---------------|-----------|-----------|-----------|-----------|-----------|--------------|------------|
 | key_element_1 | 12        | 30        | 30        | 30        | ABC       | 22.67        | 10000      |
 | key_element_1 | 20        | 40        | 25        | 10        | DEF       | 43.99        | 20000      |
 | key_element_2 | 30        | 21        | 100       | 40        | KKJ       | 3333.99      | 324300     |
 | key_element_2 | 35        | 34        | 62        | 90        | LOIP      | 432435.6     | 320000     |
 | key_element_3 | 10        | 60        | 200       | 11        | SSDS      | 1221.5       | 120000     |


## Partitioning strategy

Columnar data partitions are more efficient when querying, but if that is applicable depends on the data itself.
Parquet data format storage was *not explored* in this solution, and generally be considered when designing Athena based solutions

Here we used tabular data strategy.
In above case, we always receive user input, defined by **attr1_num, attr2_num, attr3_num and attr4_num/ attr5_num (optional)**.
This means, that we could partition our data, to have first mandatory elements and then optional (last partitions).

A good strategy to partition data can be then:


```
attr1_num=<data_range>/attr2_num=<data_range>/attr3_num=<data_range>/attr4_num=<data_range>/attr5_num=<data_range>
```

Example:

```
results/attr1_num=0-10/attr2_num=0-9/attr3_num=0-18/attr4_num=31-43/attr5_num=31-53/tabular_data_file.csv
```

This means, when client app is looking for 'key_element' with input data set of :


```
attr1_num=7,attr2_num=0, attr3_num=12, attr4_num=attr5_num=40
```

then above partition will be queried (by Athena by having right where clauses in SQL) for files to read all 'key_element' for the input data.

If the client is looking for 'key_element' with input set of : *attr1_num=7,attr2_num=0, attr3_num=12* ( with no attr4_num/attr5_num ), Athena query would scan all the files under partition *"attr1_num=0-10/attr2_num=0-9/attr3_num=0-18"* - for each sub partition under this.

Athena does this in parallel, not sequentially and querying without *'attr4/attr5'* would not make much negative impact in performance.

However, querying with just *attr1_num=5* would mean scanning of all files under *"attr1_num=0-10"* partition, which would be GB's of data, resulting in huge latency & high cost.


Below are some tips and learnings on how to strategize partitioning.


### Design partitions carefully

It would always take some study to analyze the data and see how best the partitioning could be to have an optimal number of partitions with not too large or too small files. Note that querying is priced based on data scanned and querying time.

AWS recommends (seen somewhere, experienced also) a file size of 128 MB, but it can be smaller.
Note than more data we scan, more we pay and more we add latency in the query.
This means, we need to balance number of partitions ( too many would be overhead for athena to first identify the right partition to look into)
and size of file in each partition ( some partitions having few KBs while some having 800 MB is imbalance, while 1 MB to 100 MB in each partition could be optimal)

Partitions can look like this:

```
Using 24 attr1 ranges as  [(0, 65), (66, 265), (266, 465), (466, 665), (666, 865), (866, 1065), (1066, 1265), (1266, 1465), (1466, 1665), (1666, 1865), (1866, 2065), (2066, 2265), (2266, 2465), (2466, 2665), (2666, 7665), (7666, 12665), (12666, 42665), (42666, 72665), (72666, 102665), (102666, 132665), (132666, 162665), (162666, 192665), (192666, 222665), (222666, -1)]
Using 17 attr2 ranges as  [(0, 17), (18, 817), (818, 1617), (1618, 2417), (2418, 3217), (3218, 4017), (4018, 4817), (4818, 5617), (5618, 6417), (6418, 7217), (7218, 8017), (8018, 17017), (17018, 26017), (26018, 35017), (35018, 44017), (44018, 1039017), (1039018, -1)]
Using 8 attr3/attr4 ranges as  [(-64, -58), (-57, -13), (-12, 32), (33, 77), (78, 122), (123, 167), (168, 212), (213, -1)]
```

Note that for your data, most of the common inputs maybe between 0-2500.
See the 'attr1 ranges' above : they are split with ranges of 200 until 2665 and then they are split for a range of 5000 until 12665, and later a range of 30000.

Reason is that you expected lesser data for very high 'attr1' input, so increase the ranges as above, to avoid ending up having very small sized files.

At the same time, we have very lower ranges for frequently used & supported 'attr1' inputs to avoid a larger range which then ends up having large files.
It depends on the data that we are trying to partition !

Same philosophy applies for subsequent attributes; and together, arrive at an optimal partition count and a reasonable file size in each partition.
This may take few iterations and reverse engineering to find optimal ranges to partition data and see how data spans out
( or as a data scientist you can use algorithms to find best ranges )

One approach can be to use hit & trial, to ran queries on larger partitions to see time taken ( 4+ seconds in query would mean we need to reduce file size in partition, indicating you need to reduce partition range)


### Other key considerations


1\. Note than we did not use even standard numeric values in partition ranges, such as 0-50, 50-250 and so on. Reason can be to leave a futuristic thought to allow queries on ranges. 
   If client app says that "attr1_num" is "around 50", we might want to add tolerance of +-10% and query for 45  to 55 range, right ?
   Doing so, we would most probably still hit one single partition, and reduce the hops in partition and number of files scanned

2\. Try to keep optimal size of data where athena queries run; in the first version of my real project, we reduced ~200GB of data to 15 GB of data, 
   keeping only required attributes. Less amount of data scan means less cost and higher speeds. Also keeping only needed data in S3 in STANDARD tier as there is S3 storage cost,
   we do not want to keep redundant data forever, which in long run would be costly.

3\. "When Athena reads data, it assigns different ranges of files to different nodes, to maximize parallel processing of the data. Each range is known as a split and files that can be read in parallel are called splittable"
   It was observed by experiments, that about 10-50 MB of a file size is optimal, bigger files have more latency to process. Note that too small files, 20KB for example, would
   not be too fast, athena takes some minimum time to process each file. Though this would matter in the cost incurred when querying.

4\. There are recommended techniques to compress the data. The support can be provided in the code, but it was observed that decompressing when querying has its own overhead.
   If you can keep the files to a smaller size, 10-50 MB, compression is not needed. Do check and compare the query result time
   with the compression techniques verses non-compressed data.

5\. Query itself be designed carefully, try to optimize the queries. Use AI to optimize queries, but ensure that you select only required 
   columns and do not scan more data than necessary.

6\. When preparing partitions, you need some temporary storage to collect all data for each 'key' under a partition. EFS is one option, but based on experience, it turned out to be too costly, S3 was used as temporary shared storage, but you need to delete the temporary files after merging and upload to a destination.
   Using S3 makes the processing little slow ( 5 hours to say 6 hours at most for my case with 250 GB of data), but as compared to EFS cost, when processing itself is one time or infrequent, S3 is the preferred option

7\. Give  a timeout to each query, say if the query expected completion in 2-3 seconds, and it did not complete in 5 seconds - stop querying for status,
   instead submit a request to stop the query itself to avoid long-running or indefinite queries.

8\. Cost of querying depends on the amount of data scanned and then the query time. Each time a query is fired, there is an overhead to provision an instance (internally done by Athena serverless)
   which allocates compute to Athena query engine. Time to do this, may vary from 100-400 ms and this is additional time taken, apart from main query time which 
   can be 2-5 seconds in this application. Stats can be  collected and produced in API response (recommended for easier trace of performance bottlenecks).

9\. Continued, Athena provides options for provisioned capacity, but that is minimum 4 DPU (1 DPU=4 VCPU); if you do not need 16 vCPU for your app, you should keep no 
   provisioned capacity to save on redundant compute.  This option is good where we have say 15-20 Athena based applications in our system.

10\. Continued, Athena serverless can be warmed up by firing a simple query (SELECT A from DB.TABLE LIMIT 1) just before we expect client to do actual querying. 
   This will make Athena spin up compute and hopefully, keep it warmed up until the real query is fired (of course not guaranteed but this technique is quite effective
   for example, with heavy lambda functions)

11\. Create index of partitions. Partition count that are 3K-4K are ideal; more partitions mean overhead and indexing of partition helps.
    This can be done in the back end data processing workflow; when the last partition is processed, call MSCK REPAIR TABLE.
    There is another method to load partitions from AWS Glue console, but that hangs and this approach was discarded (could not trace reason for hung nature)
    
12\. Athena is an async process; you submit a query and then wait for status, by querying for reference ID provided when query was submitted, until query status is completed or failed for the query;
        do not query too frequently; query for first status at least after 0.6-0.7 seconds (minimum time taken by Athena even for simplest queries; 
        If the status is still running, query in reduced time intervals such as:

        wait for 0.6 secs before querying for execution status
         incomplete query exec state found RUNNING, wait secs before re-query 10
         incomplete query exec state found RUNNING, wait secs before re-query 9.0
         incomplete query exec state found RUNNING, wait secs before re-query 8.1

13\. When preparing database, reduce volume of data by filtering such as trimming data, removing based on any thresholds ( too less or too high output values for some inputs), 
    keeping only desired columns, converting to required format to avoid post query processing etc.

14\. If your use case needs, you can cache Athena query results for upto 7 days

15\. Use AWS pricing calculator to get approximate cost depending on system load and amount of data scanned (average) per query.
