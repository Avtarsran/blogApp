/*
  Warnings:

  - The `tag` column on the `Tags` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Tags" DROP COLUMN "tag",
ADD COLUMN     "tag" TEXT[];
